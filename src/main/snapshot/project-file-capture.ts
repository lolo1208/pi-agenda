import { copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

const EXCLUDED_NAMES = new Set(['.git', '.pi-agenda', '.pi-console', '.cherrypi', 'node_modules', 'dist', 'out', 'release', '.aws', '.ssh'])

function shouldExcludeEntry(name: string): boolean {
  return EXCLUDED_NAMES.has(name.toLowerCase()) || /^\.env(?:\.|$)/i.test(name)
}

export async function copyProjectFiles(sourceRoot: string, stagingRoot: string): Promise<void> {
  const copyDirectory = async (source: string, target: string): Promise<void> => {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (shouldExcludeEntry(entry.name)) continue
      const sourcePath = path.join(source, entry.name)
      const targetPath = path.join(target, entry.name)

      if (entry.isSymbolicLink()) throw new Error(`暂不支持快照符号链接：${path.relative(sourceRoot, sourcePath)}`)
      if (entry.isDirectory()) {
        await mkdir(targetPath, { recursive: true })
        await copyDirectory(sourcePath, targetPath)
      } else if (entry.isFile()) {
        await copyFile(sourcePath, targetPath)
      } else {
        throw new Error(`暂不支持特殊文件：${entry.name}`)
      }
    }
  }

  await copyDirectory(sourceRoot, stagingRoot)
}
