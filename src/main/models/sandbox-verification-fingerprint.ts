import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { SandboxBackend } from '../../shared/sandbox'

/** 不记录文件内容；系统、宿主、项目身份和关键目录权限变化时让检测记录失效。 */
export async function sandboxVerificationFingerprint(options: { runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[] }, backend: SandboxBackend, project: string): Promise<string> {
  const directories = [...new Set([project, options.runtimeDirectory, options.dataDirectory, ...options.protectedDirectories, ...['.git', '.agents', '.codex', '.aws', '.pi-runner'].map(name => path.join(project, name))])]
  const identities = await Promise.all(directories.map(async directory => {
    try { const actual = await realpath(directory), info = await stat(actual); return { path: actual, dev: info.dev, ino: info.ino, created: info.birthtimeMs } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { path: path.resolve(directory), missing: true } }
  }))
  const existing = identities.filter(item => !('missing' in item)).map(item => "'" + item.path.replace(/'/g, "''") + "'")
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; @(${existing.join(',')}) | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl } | ConvertTo-Json -Compress`
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, encoding: 'utf8' })
  const manifest = await readFile(path.join(options.runtimeDirectory, backend === 'mxc' ? 'manifest.json' : 'appcontainer-manifest.json'), 'utf8')
  return createHash('sha256').update(JSON.stringify({ policy: 2, platform: process.platform, release: os.release(), arch: process.arch, user: os.userInfo().username, backend, manifest, identities, permissions: JSON.parse(stdout.trim()) })).digest('hex')
}
