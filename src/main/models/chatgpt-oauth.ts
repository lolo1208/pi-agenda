import { createHash, randomBytes } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AuthInteraction, CredentialStore, OAuthCredential } from '@earendil-works/pi-ai'
import { ModelError } from './model-validation'

// 与 pi 的 openai-codex OAuth 协议保持一致，网络请求由应用注入。
const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
const redirectUri = 'http://localhost:1455/auth/callback'
const tokenUrl = 'https://auth.openai.com/oauth/token'
const providerId = 'openai-codex'

export async function exchangeChatgptToken(fetchRequest: typeof fetch, fields: Record<string, string>, signal: AbortSignal): Promise<OAuthCredential> {
  const operation = fields.grant_type === 'refresh_token' ? '续期' : '交换'
  let response: Response
  try {
    response = await fetchRequest(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, client_id: clientId }), redirect: 'error', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
  } catch {
    signal.throwIfAborted()
    throw new ModelError(`ChatGPT 令牌${operation}无法连接服务，请检查系统代理或网络后重新授权`)
  }
  if (!response.ok) throw new ModelError(`ChatGPT 令牌${operation}被服务拒绝（HTTP ${response.status}），请检查网络后重新授权`)
  let value: Record<string, unknown>
  try { value = await response.json() } catch { throw new ModelError(`ChatGPT 令牌${operation}返回格式无效，请重新授权`) }
  if (!value || typeof value.access_token !== 'string' || !value.access_token || typeof value.refresh_token !== 'string' || !value.refresh_token || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new ModelError(`ChatGPT 令牌${operation}缺少必要字段，请重新授权`)
  let accountId: unknown
  try { accountId = JSON.parse(Buffer.from(value.access_token.split('.')[1], 'base64url').toString('utf8'))['https://api.openai.com/auth']?.chatgpt_account_id } catch { /* 不展示令牌或上游正文。 */ }
  if (typeof accountId !== 'string' || !accountId) throw new ModelError('ChatGPT 授权缺少账号信息，请重新授权')
  return { type: 'oauth', access: value.access_token, refresh: value.refresh_token, expires: Date.now() + value.expires_in * 1000, accountId }
}

function page(response: ServerResponse, status: number, title: string, detail: string): void {
  const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" })
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Pi Agenda</title><style>body{margin:0;background:#f2f2ee;color:#202623;font:16px system-ui;display:grid;place-items:center;min-height:100vh}main{max-width:560px;padding:40px}p{line-height:1.8}small{color:#657069}</style><main><small>Pi Agenda · 行动派</small><h1>${escape(title)}</h1><p>${escape(detail)}</p></main></html>`)
}

/** 只有令牌已交换且已加密保存，浏览器回调页才报告授权成功。 */
export async function loginChatgpt(interaction: AuthInteraction, credentials: CredentialStore, fetchRequest: typeof fetch): Promise<OAuthCredential> {
  const signal = interaction.signal ?? new AbortController().signal
  signal.throwIfAborted()
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(16).toString('hex')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorization = new URL('https://auth.openai.com/oauth/authorize')
  authorization.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid profile email offline_access',
    code_challenge: challenge, code_challenge_method: 'S256', state, id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: 'pi-agenda' }).toString()
  let resolve!: (credential: OAuthCredential) => void, reject!: (error: unknown) => void
  const completed = new Promise<OAuthCredential>((yes, no) => { resolve = yes; reject = no })
  completed.catch(() => undefined)
  let claimed = false, settled = false
  const succeed = (value: OAuthCredential): void => { if (!settled) { settled = true; resolve(value) } }
  const fail = (error: unknown): void => { if (!settled) { settled = true; reject(error) } }
  const exchange = async (code: string): Promise<OAuthCredential> => {
    const credential = await exchangeChatgptToken(fetchRequest, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }, signal)
    signal.throwIfAborted()
    await credentials.modify(providerId, async () => credential, { signal })
    return credential
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost:1455')
      if (request.method !== 'GET' || url.pathname !== '/auth/callback') { page(response, 404, '回调地址无效', '请从 Pi Agenda 重新开始授权。'); return }
      if (url.searchParams.get('state') !== state) { page(response, 400, '授权不匹配', '请使用本次授权链接重新登录。'); return }
      if (claimed || settled) { page(response, 409, '本次授权已处理', '请返回 Pi Agenda 查看授权状态。'); return }
      if (url.searchParams.has('error')) { const error = new ModelError('ChatGPT 浏览器授权未完成，请重新登录'); page(response, 400, '授权未完成', error.message); fail(error); return }
      const code = url.searchParams.get('code')
      if (!code) { page(response, 400, '缺少授权码', '请返回 Pi Agenda 重新开始授权。'); return }
      claimed = true
      try {
        const credential = await exchange(code)
        page(response, 200, '授权成功', 'ChatGPT 账号已授权，凭证已加密保存。现在可以关闭此页面，返回 Pi Agenda。')
        succeed(credential)
      } catch (error) {
        page(response, 502, '授权未完成', error instanceof ModelError ? error.message : '授权处理失败，请返回 Pi Agenda 重新授权。')
        fail(error)
      }
    })().catch(fail)
  })
  let listening = false
  const manualController = new AbortController()
  const abort = (): void => fail(new Error('已取消授权'))
  signal.addEventListener('abort', abort, { once: true })
  try {
    try {
      await new Promise<void>((yes, no) => { server.once('error', no); server.listen(1455, '127.0.0.1', () => { server.removeListener('error', no); listening = true; yes() }) })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw new ModelError('无法启动本地授权回调，请检查端口 1455 后重试')
    }
    server.on('error', fail)
    signal.throwIfAborted()
    interaction.notify({ type: 'auth_url', url: authorization.href })
    const manualSignal = AbortSignal.any([signal, manualController.signal])
    void interaction.prompt({ type: 'manual_code', message: '浏览器未自动返回时，请粘贴完整回调地址', placeholder: redirectUri, signal: manualSignal }).then(async value => {
      if (settled || claimed) return
      let url: URL
      try { url = new URL(value) } catch { throw new ModelError('请粘贴完整的浏览器回调地址') }
      if (url.origin !== 'http://localhost:1455' || url.pathname !== '/auth/callback' || url.searchParams.get('state') !== state || !url.searchParams.get('code')) throw new ModelError('回调地址与本次授权不匹配，请重新登录')
      claimed = true
      succeed(await exchange(url.searchParams.get('code')!))
    }).catch(error => { if (!manualSignal.aborted && !settled) fail(error) })
    return await completed
  } finally {
    manualController.abort(); signal.removeEventListener('abort', abort)
    if (listening) server.close()
  }
}
