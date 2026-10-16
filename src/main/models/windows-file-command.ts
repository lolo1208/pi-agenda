import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { literalFileCommand } from './windows-command-parser'
import { validateOrdinaryPath, validateOrdinaryTree } from './filesystem-tools'

/** 只替换语义一致的项目内文件操作；复合、覆盖、链接及特殊目录仍由原流程处理。 */
export async function delegateWindowsFileCommand(command: string, guard: (value: string) => Promise<string>, signal?: AbortSignal): Promise<{ tool: string; args: Record<string, unknown> } | undefined> {
  const parsed = literalFileCommand(command)
  if (!parsed) return undefined
  const source = await guard(parsed.path)
  await validateOrdinaryPath(source)
  const info = await lstat(source).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
  if (parsed.action === 'mkdir') {
    if (info) return undefined
    return { tool: 'mkdir', args: { path: source } }
  }
  if (!info) return undefined
  if (info.isDirectory()) await validateOrdinaryTree(source, async child => { await guard(child) }, signal)
  if (parsed.action === 'remove') {
    return { tool: info.isDirectory() ? 'rmdir' : 'delete', args: { path: source, ...(info.isDirectory() ? { recursive: parsed.recursive === true } : {}) } }
  }
  if (info.isDirectory() && parsed.action === 'copy' && !parsed.recursive) return undefined
  const destination = await guard(parsed.destination!)
  await validateOrdinaryPath(destination)
  const existing = await lstat(destination).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
  if (existing) return undefined
  // 专用工具会创建父目录；PowerShell 的复制/移动要求父目录已经存在。
  try { if (!(await lstat(path.dirname(destination))).isDirectory()) return undefined } catch { return undefined }
  return { tool: parsed.action, args: { path: source, destination } }
}
