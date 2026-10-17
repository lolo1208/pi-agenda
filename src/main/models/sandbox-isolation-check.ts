import { SANDBOX_CHECKS } from '../../shared/sandbox'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TerminalSandbox } from './terminal-sandbox'
import { ModelError } from './model-validation'
import { createSandboxCheckWorkspace } from './sandbox-check-workspace'

const literal = (value: string): string => "'" + value.replace(/'/g, "''") + "'"
/** 在独立测试工作区真正启动隔离进程，快速检查读写和两个外部边界。 */
export async function checkCachedSandboxIsolation(sandbox: TerminalSandbox, _project: string, dataDirectory: string, signal: AbortSignal): Promise<void> {
  const workspace = await createSandboxCheckWorkspace()
  const { project: folder, outside } = workspace
  const outsideFile = path.join(outside, 'outside.txt'), privateFile = path.join(dataDirectory, `isolation-check-${randomUUID()}.txt`)
  const token = randomUUID(), file = path.join(folder, 'test.txt')
  try {
    await sandbox.prepare(folder, signal)
    await mkdir(dataDirectory, { recursive: true })
    await writeFile(outsideFile, token); await writeFile(privateFile, token)
    const blocked = (command: string): string => `try { ${command}; exit 23 } catch { }`
    const command = `[IO.File]::WriteAllText(${literal(file)},'ok'); if ([IO.File]::ReadAllText(${literal(file)}) -ne 'ok') { exit 24 }; [IO.File]::Delete(${literal(file)}); ${blocked(`[IO.File]::ReadAllText(${literal(outsideFile)}) | Out-Null`)}; ${blocked(`[IO.File]::WriteAllText(${literal(outsideFile)},'unexpected')`)}; ${blocked(`[IO.File]::ReadAllText(${literal(privateFile)}) | Out-Null`)}; Write-Output '${token}'`
    let output = ''
    const result = await sandbox.exec(command, folder, { signal, timeout: 20, onData: data => { output = (output + data.toString('utf8')).slice(-8000) } })
    if (result.exitCode !== 0 || !output.includes(token) || await readFile(outsideFile, 'utf8') !== token) throw new ModelError('已有隔离环境未通过快速边界校验，请重新检测')
  } finally {
    await Promise.all([workspace.cleanup(), rm(privateFile, { force: true })])
  }
}
/** 所有探针只接触本次创建的测试文件；拒绝必须有来自隔离进程的明确标记。 */
export async function checkSandboxIsolation(sandbox: TerminalSandbox, _project: string, dataDirectory: string, signal: AbortSignal, check: (id: string, label: string, action: () => Promise<void>) => Promise<void>): Promise<void> {
  const workspace = await createSandboxCheckWorkspace()
  const { project: projectProbe, outside } = workspace
  const privateFile = path.join(dataDirectory, `isolation-check-${randomUUID()}.txt`)
  const outsideFile = path.join(outside, 'outside.txt')
  const token = randomUUID()
  try {
    await sandbox.prepare(projectProbe, signal)
    await mkdir(dataDirectory, { recursive: true })
    await writeFile(outsideFile, token); await writeFile(privateFile, token)
    const run = async (command: string, marker: string): Promise<void> => {
      signal.throwIfAborted()
      let output = ''
      const result = await sandbox.exec(command, projectProbe, { signal, timeout: 25, onData: data => { output = (output + data.toString('utf8')).slice(-16000) } })
      if (result.exitCode !== 0 || !output.includes(marker)) throw new ModelError(`隔离测试未通过：${output.trim().slice(-1800) || '隔离进程未返回有效测试结果'}`)
    }
    const blocked = (command: string): Promise<void> => run(`try { ${command}; Write-Output 'UNEXPECTED_ACCESS'; exit 23 } catch { Write-Output 'ACCESS_BLOCKED' }`, 'ACCESS_BLOCKED')
    await check('project', SANDBOX_CHECKS.project.label, async () => {
      const folder = path.join(projectProbe, 'files'), file = path.join(folder, 'example.txt')
      await run(`[IO.Directory]::CreateDirectory(${literal(folder)}) | Out-Null; [IO.File]::WriteAllText(${literal(file)},'first'); [IO.File]::WriteAllText(${literal(file)},'second'); if ([IO.File]::ReadAllText(${literal(file)}) -ne 'second') { throw '内容不一致' }; [IO.Directory]::Delete(${literal(folder)},$true); Write-Output 'PROJECT_OK'`, 'PROJECT_OK')
    })
    await check('outside', SANDBOX_CHECKS.outside.label, async () => {
      await blocked(`[IO.File]::ReadAllText(${literal(outsideFile)}) | Out-Null`)
      await blocked(`[IO.File]::WriteAllText(${literal(outsideFile)},'unexpected')`)
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('项目外写入隔离无效，已禁用自动终端执行')
    })
    await check('private', SANDBOX_CHECKS.private.label, async () => { await blocked(`[IO.File]::ReadAllText(${literal(privateFile)}) | Out-Null`) })
    await check('links', SANDBOX_CHECKS.links.label, async () => {
      const link = path.join(projectProbe, 'outside-link')
      await symlink(outside, link, 'junction')
      await blocked(`[IO.File]::ReadAllText(${literal(path.join(link, 'outside.txt'))}) | Out-Null`)
      await blocked(`[IO.File]::WriteAllText(${literal(path.join(link, 'outside.txt'))},'unexpected')`)
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('目录联接隔离无效，已禁用自动终端执行')
    })
    await check('children', SANDBOX_CHECKS.children.label, async () => {
      const shell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
      const script = `try { [IO.File]::WriteAllText(${literal(outsideFile)},'unexpected'); exit 23 } catch { Write-Output 'CHILD_BLOCKED'; exit 0 }`
      await run(`& ${literal(shell)} -NoProfile -NonInteractive -EncodedCommand '${Buffer.from(script, 'utf16le').toString('base64')}'`, 'CHILD_BLOCKED')
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('子进程隔离无效，已禁用自动终端执行')
    })
    await check('network', SANDBOX_CHECKS.network.label, async () => {
      let requests = 0
      const server = createServer((_request, response) => { requests++; response.setHeader('Content-Type', 'text/plain'); response.end(token) })
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      try {
        const address = server.address() as { port: number }
        await run(`$body=(Invoke-WebRequest 'http://127.0.0.1:${address.port}' -UseBasicParsing -TimeoutSec 5).Content; if ($body -ne '${token}') { throw '网络响应不一致' }; Write-Output 'NETWORK_OK'`, 'NETWORK_OK')
        if (requests !== 1) throw new ModelError('开发命令网络能力未通过验证')
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
    })
  } finally {
    await Promise.all([workspace.cleanup(), rm(privateFile, { force: true })])
  }
}
