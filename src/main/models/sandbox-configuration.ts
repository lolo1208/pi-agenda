import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 仅用于宿主刚创建、尚未交给命令使用的临时区，不修补不可信的已有路径。 */
export async function prepareSandboxConfiguration(scratch: string): Promise<void> {
  await Promise.all(['config', 'cache', 'npm-cache', 'pnpm-store', 'pnpm-home', 'corepack'].map(name => mkdir(path.join(scratch, name))))
  await Promise.all(['npmrc', 'npm-globalrc'].map(name => writeFile(path.join(scratch, 'config', name), '', { flag: 'wx' })))
}
