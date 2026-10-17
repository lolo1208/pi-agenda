import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { literalCommand } from './windows-command-parser'

const programs = new Set(['node', 'npm', 'npx', 'pnpm', 'corepack', 'yarn', 'git', 'cargo', 'rustc', 'rustup', 'python', 'python3', 'py', 'dotnet', 'go', 'java', 'javac', 'protoc', 'chrome', 'msedge', 'chromium', 'chrome-headless-shell', 'firefox', 'curl', 'wget', 'invoke-webrequest', 'invoke-restmethod'])
const helpers = new Set(['write-output', 'write-host', 'out-null', 'out-string', 'select-object', 'where-object', 'foreach-object', 'test-path'])
function name(value: string): string { return path.win32.basename(value).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase() }

/** 只分析语法，不执行脚本；开发调用可联网，但不会因此获得项目外普通文件权限。 */
export async function developerCommand(command: string, signal?: AbortSignal): Promise<boolean> {
  const literal = literalCommand(command)
  if (literal && !/^['"]/.test(command.trim())) return programs.has(name(literal[0]))
  if (!command.trim() || command.length > 100000) return false
  if (process.platform !== 'win32') {
    const parts = command.split(/[;\r\n]/).map(value => value.trim()).filter(Boolean).map(literalCommand)
    return parts.length > 0 && parts.every(tokens => !!tokens && programs.has(name(tokens[0])))
  }
  const source = Buffer.from(command, 'utf16le').toString('base64')
  const script = `$tokens=$null; $errors=$null; $ast=[Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${source}')),[ref]$tokens,[ref]$errors); if ($errors.Count) { exit 2 }; $names=@($ast.FindAll({param($item) $item -is [Management.Automation.Language.CommandAst]},$true) | ForEach-Object { $name=$_.GetCommandName(); if ($null -eq $name) { '__DYNAMIC_COMMAND__' } else { $name } }); ConvertTo-Json -InputObject $names -Compress`
  try {
    const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, signal, timeout: 10000, maxBuffer: 1024 * 1024 })
    const names: unknown = JSON.parse(stdout.trim())
    return Array.isArray(names) && names.length > 0 && names.some(value => typeof value === 'string' && programs.has(name(value))) && names.every(value => typeof value === 'string' && (programs.has(name(value)) || helpers.has(name(value))))
  } catch { signal?.throwIfAborted(); return false }
}
