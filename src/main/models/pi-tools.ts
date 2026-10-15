import { lstat, realpath, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createLsToolDefinition, createFindToolDefinition, createGrepToolDefinition, createPowerShellToolDefinition, createBashToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import type { PermissionMode } from '../../shared/models'
import { commandApprovalReason, highRiskFileMutation, safeFileCommand, safeLocationCommand } from './tool-permissions'
import { createDeleteToolDefinition, validateDeleteFile } from './delete-tool'
import { filesystemToolDefinitions, validateOrdinaryPath, validateOrdinaryTree } from './filesystem-tools'
import type { TerminalSandbox } from './terminal-sandbox'

const fileMutations = new Set(['edit', 'write', 'delete', 'mkdir', 'rmdir', 'move', 'copy'])
const treeOperations = new Set(['rmdir', 'move', 'copy'])

export interface ToolPermissionContext {
  mode: PermissionMode
  project?: string
  protectedDirectories: string[]
  sandbox?: TerminalSandbox
  approve(id: string, tool: string, args: Record<string, unknown>, reason: string, signal?: AbortSignal): Promise<void>
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** 对不存在的文件也解析最近的已有父目录，防止通过链接目标绕过审批。 */
export async function canonicalToolPath(target: string): Promise<string> {
  try { return await realpath(target) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    if (parent === target) return target
    return path.join(await canonicalToolPath(parent), path.basename(target))
  }
}

const hiddenData = new Set(['.git', '.pi-agenda'])
const hiddenProjectData = (name: string): boolean => hiddenData.has(name.toLowerCase()) || name.startsWith('.pi-agenda-check-')

/** 搜索逐项检查边界，不跟随链接，也不扫描应用内部数据。 */
async function* ordinaryFiles(target: string, protectedDirectories: string[], signal?: AbortSignal, includeDirectories = false): AsyncGenerator<string> {
  signal?.throwIfAborted()
  const info = await lstat(target)
  if (info.isSymbolicLink() || hiddenData.has(path.basename(target).toLowerCase()) || path.basename(target).startsWith('.pi-agenda-check-') || protectedDirectories.some(directory => within(directory, target))) return
  if (info.isFile()) { yield target; return }
  if (!info.isDirectory()) return
  if (includeDirectories) yield target
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.isSymbolicLink()) continue
    yield* ordinaryFiles(path.join(target, entry.name), protectedDirectories, signal, includeDirectories)
  }
}

async function restrictedSearch(tool: string, args: Record<string, unknown>, protectedDirectories: string[], signal?: AbortSignal) {
  const target = String(args.path)
  const limit = Math.max(1, Math.min(1000, Number(args.limit) || 100))
  const lines: string[] = []
  let visited = 0
  let matcher: RegExp | undefined
  if (tool === 'grep' && args.literal !== true) {
    try { matcher = new RegExp(String(args.pattern), args.ignoreCase ? 'i' : '') }
    catch { throw new ModelError('搜索正则表达式无效') }
  }
  for await (const file of ordinaryFiles(target, protectedDirectories, signal, tool === 'find')) {
    if (++visited > 20000 || lines.length >= limit) break
    const relative = path.relative(target, file).split(path.sep).join('/') || path.basename(file)
    if (tool === 'find') {
      if (path.matchesGlob(relative, String(args.pattern)) || path.matchesGlob(path.basename(file), String(args.pattern))) lines.push(relative)
      continue
    }
    if (args.glob && !path.matchesGlob(relative, String(args.glob)) && !path.matchesGlob(path.basename(file), String(args.glob))) continue
    if ((await lstat(file)).size > 1024 * 1024) continue
    const text = await readFile(file, 'utf8')
    if (text.includes('\0')) continue
    const contents = text.split(/\r?\n/)
    const pattern = args.ignoreCase ? String(args.pattern).toLowerCase() : String(args.pattern)
    const context = Math.max(0, Math.min(10, Number(args.context) || 0))
    for (let index = 0; index < contents.length && lines.length < limit; index++) {
      signal?.throwIfAborted()
      if (matcher ? matcher.test(contents[index]) : (args.ignoreCase ? contents[index].toLowerCase() : contents[index]).includes(pattern)) {
        lines.push(contents.slice(Math.max(0, index - context), index + context + 1).map((line, offset) => `${relative}:${Math.max(0, index - context) + offset + 1}: ${line.slice(0, 500)}`).join('\n'))
      }
    }
  }
  return { content: [{ type: 'text' as const, text: lines.join('\n').slice(0, 50000) || '未找到匹配结果。' }], details: { resultLimitReached: lines.length >= limit || visited > 20000 } }
}

/** 解析父目录与联接点，禁止文件工具越出当前项目或修改 Git 元数据。 */
export async function projectToolPath(root: string, value: string): Promise<string> {
  const target = path.resolve(root, value)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part => hiddenProjectData(part))) throw new ModelError('工具只能访问当前项目内的普通文件')
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

export function piProjectTools(root: string, beforeMutation: () => Promise<void>, permissions?: ToolPermissionContext): ToolDefinition[] {
  const protectPath = async (target: string): Promise<void> => {
    if (await canonicalToolPath(target) !== target) throw new ModelError('操作期间目标路径发生变化，请重新请求操作')
    for (const directory of permissions?.protectedDirectories ?? []) {
      if (within(await canonicalToolPath(directory), target)) throw new ModelError('工具不能访问应用内部会话、凭据或快照数据')
    }
    if (target.split(path.sep).some(part => hiddenProjectData(part))) throw new ModelError('文件工具不能访问 Git 元数据或应用内部数据')
  }
  const definitions: ToolDefinition<any, any>[] = [createReadToolDefinition(root), createEditToolDefinition(root), createWriteToolDefinition(root), createDeleteToolDefinition(), ...filesystemToolDefinitions(protectPath), createLsToolDefinition(root), createFindToolDefinition(root), createGrepToolDefinition(root), process.platform === 'win32' ? createPowerShellToolDefinition(root) : createBashToolDefinition(root)]
  return definitions.map(tool => ({ ...tool,
    ...(['bash', 'powershell'].includes(tool.name) ? {
      description: `${tool.description} 受限自动模式下在系统沙箱内运行，项目外访问和联网会被拦截。Windows 工作目录映射为 Project:，原生程序的工作目录仍为项目路径。Windows PowerShell 5 的部分路径命令（包括 Remove-Item）会额外读取项目祖先而失败；此时使用专用文件工具或 System.IO API，不要申请沙箱外权限。仅当确实需要项目外访问或联网时设置 outsideSandbox=true，应用将请求本次批准。不要因普通语法或程序错误申请脱离沙箱。`,
      parameters: { ...tool.parameters, properties: { ...tool.parameters.properties, outsideSandbox: { type: 'boolean', description: '显式申请脱离系统沙箱执行，需要用户批准；默认 false' } } }
    } : {}),
    ...(['find', 'grep'].includes(tool.name) ? { description: `${tool.name === 'find' ? '按 glob 查找普通文件和目录' : '按模式搜索普通文件内容'}；不跟随链接，排除 Git 元数据、应用内部数据和 node_modules。` } : {}),
    execute: async (id, args, signal, update, context) => {
    signal?.throwIfAborted()
    // 固定批准的参数，调用方后续修改原对象不能改变实际执行内容。
    const input = structuredClone(args) as Record<string, unknown>
    let revalidate: (() => Promise<void>) | undefined
    let executionTool = tool
    if (!permissions) {
      // 未提供权限上下文时不允许具有副作用的工具悄悄执行。
      if (fileMutations.has(tool.name) || ['bash', 'powershell'].includes(tool.name)) throw new ModelError('工具执行缺少权限上下文')
      input.path = await projectToolPath(root, typeof input.path === 'string' ? input.path : '.')
    } else if (['bash', 'powershell'].includes(tool.name)) {
      const command = String(input.command ?? '')
      let reason = commandApprovalReason(permissions.mode, command)
      if (input.outsideSandbox === true) reason = '本次命令申请脱离系统沙箱，将获得当前用户的本机权限，需要确认'
      else if (permissions.mode === 'auto' && permissions.project && !safeLocationCommand(command) && !safeFileCommand(command) && permissions.sandbox) {
        try {
          await permissions.sandbox.prepare(root, signal)
          executionTool = process.platform === 'win32' ? createPowerShellToolDefinition(root, { operations: permissions.sandbox, exposeSessionEnvironment: false }) : createBashToolDefinition(root, { operations: permissions.sandbox, exposeSessionEnvironment: false })
          reason = undefined
        } catch (error) {
          signal?.throwIfAborted()
          if (permissions.sandbox.failClosed) throw error
          reason = `${error instanceof Error ? error.message : '终端系统沙箱不可用'}。如批准，将脱离沙箱执行本次命令`
        }
      }
      if (reason) await permissions.approve(id, tool.name, input, reason, signal)
      signal?.throwIfAborted()
      if (safeLocationCommand(command)) return { content: [{ type: 'text' as const, text: root }], details: {} }
      const fileCommand = safeFileCommand(command)
      if (fileCommand) {
        const delegated = piProjectTools(root, beforeMutation, {
          ...permissions,
          // 默认模式已批准完整命令；规范路径与内部数据保护仍在文件工具中执行。
          ...(reason ? { approve: async () => {} } : {})
        }).find(definition => definition.name === fileCommand.tool)!
        return delegated.execute(id, { path: fileCommand.path } as never, signal, update, context)
      }
    } else {
      const requestedPath = path.resolve(root, typeof input.path === 'string' ? input.path : '.')
      if (tool.name === 'delete') {
        if (typeof input.path !== 'string' || !input.path.trim()) throw new ModelError('请提供待删除文件的确切路径')
        await validateDeleteFile(requestedPath)
      }
      const mutation = fileMutations.has(tool.name)
      const structured = ['mkdir', 'rmdir', 'move', 'copy', 'stat'].includes(tool.name)
      if (structured) {
        if (typeof input.path !== 'string' || !input.path.trim()) throw new ModelError('请提供确切的文件或目录路径')
        await validateOrdinaryPath(requestedPath, tool.name !== 'mkdir')
      }
      const target = await canonicalToolPath(requestedPath)
      const project = permissions.project ? await canonicalToolPath(permissions.project) : undefined
      const protectedDirectories = await Promise.all(permissions.protectedDirectories.map(canonicalToolPath))
      let reason = mutation && permissions.mode === 'default' ? '“每次询问”模式下，文件和目录修改需要逐次确认' : undefined
      const checkPath = async (value: string): Promise<void> => {
        const canonical = await canonicalToolPath(value)
        if (canonical !== value) throw new ModelError('操作期间目标路径发生变化，请重新请求操作')
        if (protectedDirectories.some(directory => within(directory, value))) throw new ModelError('工具不能访问应用内部会话、凭据或快照数据')
        if (value.split(path.sep).some(part => hiddenProjectData(part))) throw new ModelError('文件工具不能访问 Git 元数据或应用内部数据')
        if (treeOperations.has(tool.name) && (value === project || value === path.parse(value).root)) throw new ModelError('工具不能删除、移动或复制项目根目录或系统根目录')
        if (!(project && within(project, value)) && permissions.mode !== 'full') reason = '目标文件或目录位于当前项目外，需要确认本次访问'
        if (mutation && highRiskFileMutation(value)) reason = '该路径涉及系统、登录或自动启动配置，所有权限模式下的修改都需确认'
      }
      let destination: string | undefined
      if (['move', 'copy'].includes(tool.name)) {
        if (typeof input.destination !== 'string' || !input.destination.trim()) throw new ModelError('请提供确切的目标路径')
        const requestedDestination = path.resolve(root, input.destination)
        await validateOrdinaryPath(requestedDestination)
        destination = await canonicalToolPath(requestedDestination)
        if (within(target, destination) || within(destination, target)) throw new ModelError('源路径和目标路径不能相同或互相包含')
        input.destination = destination
      }
      revalidate = async () => {
        if (tool.name === 'delete') await validateDeleteFile(target)
        if (structured) await validateOrdinaryPath(target, tool.name !== 'mkdir')
        await checkPath(target)
        if (treeOperations.has(tool.name)) await validateOrdinaryTree(target, async child => {
          await checkPath(child)
          if (destination) await checkPath(path.join(destination, path.relative(target, child)))
        }, signal)
        if (destination) { await validateOrdinaryPath(destination); await checkPath(destination) }
      }
      await revalidate()
      if (reason) await permissions.approve(id, tool.name, { ...input, path: target }, reason, signal)
      signal?.throwIfAborted()
      if (await canonicalToolPath(target) !== target) throw new ModelError('审批期间目标路径发生变化，请重新请求操作')
      // 固定已校验的规范路径，不再使用原始链接路径。
      input.path = target
      if (['find', 'grep'].includes(tool.name)) return restrictedSearch(tool.name, input, await Promise.all(permissions.protectedDirectories.map(canonicalToolPath)), signal)
    }
    if (fileMutations.has(tool.name) || ['bash', 'powershell'].includes(tool.name)) await beforeMutation()
    signal?.throwIfAborted()
    if (revalidate) await revalidate()
    return executionTool.execute(id, input, signal, update, context)
  } }))
}
