import { SANDBOX_CHECKS } from '../../shared/sandbox'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { checkSandboxIsolation } from './sandbox-isolation-check'
import { ModelError } from './model-validation'

export const shellLiteral = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'"

/** macOS 探针使用系统 Bash 与工具，只操作本次创建的测试文件，不依赖开发 SDK。 */
export const checkMacosSandboxIsolation: typeof checkSandboxIsolation = async (sandbox, project, dataDirectory, signal, check) => {
  const folder = await realpath(await mkdtemp(path.join(project, '.pi-agenda-check-')))
  const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pi-agenda-outside-check-')))
  const outsideFile = path.join(outside, 'outside.txt'), privateFile = path.join(dataDirectory, `isolation-check-${randomUUID()}.txt`)
  const token = randomUUID(), errorFile = path.join(folder, 'denied.txt')
  const run = async (command: string, marker: string): Promise<void> => {
    signal.throwIfAborted()
    let output = ''
    const result = await sandbox.exec('set -e\n' + command, project, { signal, timeout: 25, onData: data => { output = (output + data.toString('utf8')).slice(-16000) } })
    if (result.exitCode !== 0 || !output.includes(marker)) throw new ModelError(`macOS 隔离测试未通过：${output.trim().slice(-1800) || '隔离进程未返回有效结果'}`)
  }
  const blockedCommand = (command: string, marker = 'ACCESS_BLOCKED'): string => `if (${command}) 2>${shellLiteral(errorFile)}; then printf 'UNEXPECTED_ACCESS\\n'; exit 23; fi; if ! /usr/bin/grep -Eq 'Operation not permitted|Permission denied' ${shellLiteral(errorFile)}; then /bin/cat ${shellLiteral(errorFile)}; exit 24; fi; printf '${marker}\\n'`
  const blocked = (command: string): Promise<void> => run(blockedCommand(command), 'ACCESS_BLOCKED')
  try {
    await mkdir(dataDirectory, { recursive: true }); await writeFile(outsideFile, token); await writeFile(privateFile, token)
    await check('project', SANDBOX_CHECKS.project.label, async () => {
      const files = path.join(folder, 'files'), file = path.join(files, 'first.txt'), moved = path.join(files, 'moved.txt'), copy = path.join(files, 'copy.txt')
      await run(`/bin/mkdir ${shellLiteral(files)}; printf 'first' >${shellLiteral(file)}; printf 'second' >${shellLiteral(file)}; test "$(/bin/cat ${shellLiteral(file)})" = 'second'; /bin/mv ${shellLiteral(file)} ${shellLiteral(moved)}; /bin/cp ${shellLiteral(moved)} ${shellLiteral(copy)}; /bin/rm ${shellLiteral(moved)} ${shellLiteral(copy)}; /bin/rmdir ${shellLiteral(files)}; printf 'PROJECT_OK\\n'`, 'PROJECT_OK')
    })
    await check('outside', SANDBOX_CHECKS.outside.label, async () => {
      await blocked(`/bin/cat ${shellLiteral(outsideFile)}`); await blocked(`printf 'unexpected' >${shellLiteral(outsideFile)}`)
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('macOS 项目外写入隔离无效')
    })
    await check('private', SANDBOX_CHECKS.private.label, async () => { await blocked(`/bin/cat ${shellLiteral(privateFile)}`) })
    await check('links', SANDBOX_CHECKS.links.label, async () => {
      const link = path.join(folder, 'outside-link'); await symlink(outside, link, 'dir')
      await blocked(`/bin/cat ${shellLiteral(path.join(link, 'outside.txt'))}`)
      await blocked(`printf 'unexpected' >${shellLiteral(path.join(link, 'outside.txt'))}`)
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('macOS 符号链接隔离无效')
    })
    await check('children', SANDBOX_CHECKS.children.label, async () => {
      await run(`/bin/bash --noprofile --norc -c ${shellLiteral(blockedCommand(`printf 'unexpected' >${shellLiteral(outsideFile)}`, 'CHILD_BLOCKED'))}`, 'CHILD_BLOCKED')
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('macOS 子进程隔离无效')
    })
    await check('network', SANDBOX_CHECKS.network.label, async () => {
      let requests = 0
      const server = createServer((_request, response) => { requests++; response.end('unexpected') })
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      try {
        const port = (server.address() as { port: number }).port
        for (const url of [`http://127.0.0.1:${port}`, 'http://1.1.1.1:443']) await run(`if /usr/bin/curl --noproxy '*' --silent --show-error --connect-timeout 1 --max-time 2 ${shellLiteral(url)}; then exit 23; fi; printf 'NETWORK_BLOCKED\\n'`, 'NETWORK_BLOCKED')
        if (requests) throw new ModelError('macOS 本机网络隔离无效')
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
    })
  } finally {
    await Promise.allSettled([folder, outside].map(async root => { if (await realpath(root) === root) await rm(root, { recursive: true, force: true }) }))
    await rm(privateFile, { force: true })
  }
}
