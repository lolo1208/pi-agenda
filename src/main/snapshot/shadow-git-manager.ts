import { readdir, rm, readFile, writeFile, mkdir, lstat } from 'node:fs/promises'
import { projectToolPath } from '../models/pi-tools'
import path from 'node:path'
import type { SimpleGit } from 'simple-git'
import { openSnapshotStorage, removeSnapshotStorage } from './snapshot-storage'
import { copyProjectFiles } from './project-file-capture'
import type { ChangedFile, Checkpoint, FileDiff } from '../../shared/api'

export class ShadowGitManager {
  private queue: Promise<unknown> = Promise.resolve()
  private constructor(private readonly root: string, private readonly staging: string, private readonly git: SimpleGit) {}

  static async open(project: string, dataRoot: string): Promise<ShadowGitManager> {
    const storage = await openSnapshotStorage(project, dataRoot)
    return new ShadowGitManager(storage.root, storage.staging, storage.git)
  }

  getRoot(): string { return this.root }

  static async removeProjectStorage(project: string, dataRoot: string): Promise<string> {
    return removeSnapshotStorage(project, dataRoot)
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  createCheckpoint(label: string): Promise<Checkpoint> {
    return this.serialized(async () => {
      if (!label.trim() || label.length > 200) throw new Error('快照名称须为 1–200 个字符')
      // 仅清空快照暂存区，不修改项目工作目录。
      for (const item of await readdir(this.staging)) await rm(path.join(this.staging, item), { recursive: true, force: true })
      await copyProjectFiles(this.root, this.staging)
      await this.git.raw(['add', '--all', '--force', '--', '.'])
      await this.git.raw(['commit', '--quiet', '--allow-empty', '-m', label])
      return { hash: (await this.git.revparse(['HEAD'])).trim(), label, createdAt: new Date().toISOString() }
    })
  }

  private async validateCommit(hash: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error('无效快照标识')
    await this.git.raw(['cat-file', '-e', `${hash}^{commit}`])
  }

  getChanges(base: string, current: string): Promise<ChangedFile[]> {
    return this.serialized(async () => {
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
