import { readdir, rm, rmdir, readFile, writeFile, mkdir, lstat } from 'node:fs/promises'
import { projectToolPath } from '../models/pi-tools'
import path from 'node:path'
import type { SimpleGit } from 'simple-git'
import { openSnapshotStorage, removeSnapshotStorage, type SnapshotStorage } from './snapshot-storage'
import { copyProjectFiles } from './project-file-capture'
import type { ChangedFile, Checkpoint, FileDiff } from '../../shared/api'

export class ShadowGitManager {
  private constructor(private readonly root: string, private readonly staging: string, private readonly git: SimpleGit, private readonly serialized: SnapshotStorage['serialized']) {}

  static async open(project: string, dataRoot: string): Promise<ShadowGitManager> {
    const storage = await openSnapshotStorage(project, dataRoot)
    return new ShadowGitManager(storage.root, storage.staging, storage.git, storage.serialized)
  }

  getRoot(): string { return this.root }

  static async removeProjectStorage(project: string, dataRoot: string): Promise<string> {
    return removeSnapshotStorage(project, dataRoot)
  }

  createCheckpoint(label: string): Promise<Checkpoint> {
    return this.serialized(() => this.captureCheckpoint(label))
  }

  private async captureCheckpoint(label: string): Promise<Checkpoint> {
    if (!label.trim() || label.length > 200) throw new Error('快照名称须为 1–200 个字符')
    await this.stageProjectFiles()
    await this.git.raw(['commit', '--quiet', '--allow-empty', '-m', label])
    return { hash: (await this.git.revparse(['HEAD'])).trim(), label, createdAt: new Date().toISOString() }
  }

  private async stageProjectFiles(): Promise<void> {
    // 仅清空快照暂存区，不修改项目工作目录。
    for (const item of await readdir(this.staging)) await rm(path.join(this.staging, item), { recursive: true, force: true })
    await copyProjectFiles(this.root, this.staging)
    await this.git.raw(['add', '--all', '--force', '--', '.'])
  }

  /** 按文件内容比较当前项目与各轮结果，不创建提交，也不修改项目文件。 */
  getMatchingCheckpoints(hashes: string[]): Promise<string[]> {
    return this.serialized(async () => {
      for (const hash of hashes) await this.validateCommit(hash)
      await this.stageProjectFiles()
      const currentTree = (await this.git.raw(['write-tree'])).trim()
      const matches: string[] = []
      for (const hash of hashes) {
        if ((await this.git.revparse([`${hash}^{tree}`])).trim() === currentTree) matches.push(hash)
      }
      return matches
    })
  }

  /** 将快照覆盖范围内的整个项目恢复到目标轮次，保留恢复前的保护快照。 */
  restoreCheckpoint(targetHash: string): Promise<Checkpoint> {
    return this.serialized(async () => {
      await this.validateCommit(targetHash)
      const safety = await this.captureCheckpoint('恢复到此轮结果前的保护快照')
      const changes = await this.readChanges(safety.hash, targetHash)
      const targets = await Promise.all(changes.map(file => projectToolPath(this.root, file.path)))
      // 先读取全部目标内容，再触碰项目文件。所有 Git 操作仅针对影子仓库。
      await this.git.raw(['restore', `--source=${targetHash}`, '--worktree', '--', '.'])
      const contents = await Promise.all(changes.map(file => file.status === 'D' ? null : readFile(path.join(this.staging, file.path))))
      for (let index = 0; index < changes.length; index++) {
        if (contents[index] !== null) continue
        const target = targets[index]
        if (!(await lstat(target)).isFile()) throw new Error('恢复目标不是普通文件')
        await rm(target)
        // 只清理由后来新增文件留下的空目录，不移除未纳入快照的内容。
        let directory = path.dirname(target)
        while (directory !== this.root) {
          try { await rmdir(directory) }
          catch (error) {
            if (['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) break
            throw error
          }
          directory = path.dirname(directory)
        }
      }
      for (let index = 0; index < changes.length; index++) {
        if (contents[index] === null) continue
        await mkdir(path.dirname(targets[index]), { recursive: true })
        await writeFile(targets[index], contents[index]!)
      }
      return this.captureCheckpoint('已恢复到此轮对话结果')
    })
  }

  private async validateCommit(hash: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error('无效快照标识')
    await this.git.raw(['cat-file', '-e', `${hash}^{commit}`])
  }

  getChanges(base: string, current: string): Promise<ChangedFile[]> {
    return this.serialized(() => this.readChanges(base, current))
  }

  private async readChanges(base: string, current: string): Promise<ChangedFile[]> {
    await this.validateCommit(base); await this.validateCommit(current)
    const raw = await this.git.raw(['diff', '--numstat', '-z', '--no-renames', base, current, '--'])
    const statusRaw = await this.git.raw(['diff', '--name-status', '-z', '--no-renames', base, current, '--'])
    const parts = statusRaw.split('\0')
    const statuses = new Map<string, 'A' | 'M' | 'D'>()
    for (let i = 0; i + 1 < parts.length; i += 2) statuses.set(parts[i + 1], parts[i] as 'A' | 'M' | 'D')
    return raw.split('\0').filter(Boolean).map(record => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record)
      if (!match) throw new Error('无法解析 Git 差异')
      const [, added, deleted, file] = match
      return { path: file, status: statuses.get(file) ?? 'M', additions: Number(added) || 0, deletions: Number(deleted) || 0, binary: added === '-' }
    })
  }

  async getDiff(base: string, current: string, file: string): Promise<FileDiff> {
    const changes = await this.getChanges(base, current)
    const change = changes.find(item => item.path === file)
    if (!change) throw new Error('文件不在此轮改动列表中')
    if (change.binary) return { path: file, before: '', after: '', binary: true }
    return this.serialized(async () => ({ path: file, binary: false,
      before: change.status === 'A' ? '' : await this.git.show([`${base}:${file}`]),
      after: change.status === 'D' ? '' : await this.git.show([`${current}:${file}`])
    }))
  }

  /** 保存回滚前快照；只恢复本轮改动，并拒绝覆盖本轮之后的手动修改。 */
  async rollback(base: string, current: string): Promise<Checkpoint> {
    const changes = await this.getChanges(base, current)
    if (!changes.length) throw new Error('此轮没有需要回滚的文件改动')
    const safety = await this.createCheckpoint('回滚前保护快照')
    const subsequent = await this.getChanges(current, safety.hash)
    if (subsequent.some(file => changes.some(change => change.path === file.path))) throw new Error('本轮文件已有后续改动，已保留保护快照；请先查看差异，避免覆盖手动修改')
    await this.serialized(async () => {
      // 先验证所有路径，再恢复暂存区；Git 始终指向影子仓库。
      const targets = await Promise.all(changes.map(file => projectToolPath(this.root, file.path)))
      await this.git.raw(['restore', `--source=${base}`, '--worktree', '--', '.'])
      const contents = await Promise.all(changes.map(file => file.status === 'A' ? null : readFile(path.join(this.staging, file.path))))
      for (let index = 0; index < changes.length; index++) {
        const target = targets[index]
        if (contents[index] === null) {
          try { if (!(await lstat(target)).isFile()) throw new Error('回滚目标不是普通文件') }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          await rm(target, { force: true })
        } else {
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, contents[index]!)
        }
      }
    })
    return this.createCheckpoint('代理改动已回滚')
  }
}
