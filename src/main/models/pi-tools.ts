import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createLsToolDefinition, createFindToolDefinition, createGrepToolDefinition, createPowerShellToolDefinition, createBashToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'

/** 解析父目录与联接点，禁止文件工具越出当前项目或修改 Git 元数据。 */
export async function projectToolPath(root: string, value: string): Promise<string> {
  const target = path.resolve(root, value)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part => ['.git', '.pi-agenda'].includes(part.toLowerCase()))) throw new ModelError('工具只能访问当前项目内的普通文件')
  let current = root
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || path.relative(root, await realpath(current)).startsWith('..')) throw new ModelError('工具不能访问符号链接或项目外的目录')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return target
}

export function piProjectTools(root: string, beforeMutation: () => Promise<void>): ToolDefinition[] {
  const definitions: ToolDefinition<any, any>[] = [createReadToolDefinition(root), createEditToolDefinition(root), createWriteToolDefinition(root), createLsToolDefinition(root), createFindToolDefinition(root), createGrepToolDefinition(root), process.platform === 'win32' ? createPowerShellToolDefinition(root) : createBashToolDefinition(root)]
  return definitions.map(tool => ({ ...tool, execute: async (id, args, signal, update, context) => {
    signal?.throwIfAborted()
    const input = args as Record<string, unknown>
    if (typeof input.path === 'string') await projectToolPath(root, input.path)
    if (['edit', 'write', 'bash', 'powershell'].includes(tool.name)) await beforeMutation()
    signal?.throwIfAborted()
    return tool.execute(id, args, signal, update, context)
  } }))
}
