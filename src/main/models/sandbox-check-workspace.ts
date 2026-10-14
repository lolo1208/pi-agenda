import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** 检测使用程序专用临时工作区，避免向用户项目写入探针。 */
export async function createSandboxCheckWorkspace(): Promise<{ project: string; outside: string; cleanup(): Promise<void> }> {
  const directory = path.join(os.tmpdir(), 'pi-agenda', 'sandbox-checks')
  await mkdir(directory, { recursive: true })
  const parent = await realpath(directory)
  const root = await mkdtemp(path.join(parent, 'check-'))
  const cleanup = async (): Promise<void> => {
    // 仅删除本次分配且仍在专用目录内的根；不跟随子项符号链接。
    if (path.dirname(root) !== parent || await realpath(root) !== root) throw new Error('测试目录路径发生变化')
    await rm(root, { recursive: true, force: true })
  }
  const project = path.join(root, 'project'), outside = path.join(root, 'outside')
  try {
    await mkdir(project); await mkdir(outside)
    return { project, outside, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
