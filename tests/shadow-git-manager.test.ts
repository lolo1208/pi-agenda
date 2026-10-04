import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { ShadowGitManager } from '../src/main/snapshot/shadow-git-manager'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function project(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-console-test-'))
  roots.push(root); return root
}
async function storageRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-console-data-test-'))
  roots.push(root); return root
}
describe('ShadowGitManager', () => {
  it('keeps shadow data outside project-local .pi-console directories', async () => {
    const root = await project()
    const external = await project()
    await symlink(external, path.join(root, '.pi-console'), process.platform === 'win32' ? 'junction' : 'dir')
    const dataRoot = await storageRoot()
    const manager = await ShadowGitManager.open(root, dataRoot)
    expect(manager.getRoot()).toBe(root)
    expect((await readdir(path.join(dataRoot, 'projects'))).length).toBe(1)
    expect(await readdir(external)).toEqual([])
  })
  it('captures additions, modifications and deletions without touching the original Git index', async () => {
    const root = await project()
    const original = simpleGit({ baseDir: root, config: ['core.safecrlf=false'] })
    await original.init()
    await writeFile(path.join(root, '中文 文件.txt'), 'one\r\ntwo\r\n')
    await writeFile(path.join(root, 'deleted.txt'), 'old\n')
    await writeFile(path.join(root, '.gitattributes'), '*.txt text eol=lf\n')
    await original.add('.')
    const index = await readFile(path.join(root, '.git', 'index'))
    const dataRoot = await storageRoot()
    const manager = await ShadowGitManager.open(root, dataRoot)
    const base = await manager.createCheckpoint('base')
    await writeFile(path.join(root, '中文 文件.txt'), 'one\r\nthree\r\n')
    await rm(path.join(root, 'deleted.txt'))
    await writeFile(path.join(root, 'added.txt'), 'new\n')
    const current = await manager.createCheckpoint('end')
    expect(await manager.getChanges(base.hash, current.hash)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'added.txt', status: 'A', additions: 1 }),
      expect.objectContaining({ path: 'deleted.txt', status: 'D', deletions: 1 }),
      expect.objectContaining({ path: '中文 文件.txt', status: 'M', additions: 1, deletions: 1 })
    ]))
    expect((await manager.getDiff(base.hash, current.hash, '中文 文件.txt')).before).toBe('one\r\ntwo\r\n')
    expect((await manager.getDiff(base.hash, current.hash, 'deleted.txt')).after).toBe('')
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index)
    await expect(manager.getDiff(base.hash, current.hash, '../outside')).rejects.toThrow()
    await expect(manager.getChanges('--help', current.hash)).rejects.toThrow()
  })
  it('handles empty checkpoints, binary files, exclusions and reopening', async () => {
    const root = await project()
    const dataRoot = await storageRoot()
    const manager = await ShadowGitManager.open(root, dataRoot)
    const base = await manager.createCheckpoint('empty')
    await mkdir(path.join(root, 'node_modules'))
    await mkdir(path.join(root, '.cherrypi'))
    await writeFile(path.join(root, '.cherrypi', 'legacy-snapshot'), 'preserve outside new snapshots')
    await writeFile(path.join(root, 'node_modules', 'ignore.js'), 'ignore')
    await writeFile(path.join(root, '.env.local'), 'SECRET=do-not-capture')
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 255, 1]))
    const current = await manager.createCheckpoint('binary')
    const reopened = await ShadowGitManager.open(root, dataRoot)
    expect(await reopened.getChanges(base.hash, current.hash)).toEqual([
      { path: 'binary.bin', status: 'A', additions: 0, deletions: 0, binary: true }
    ])
    expect((await reopened.getDiff(base.hash, current.hash, 'binary.bin')).binary).toBe(true)
    const next = await reopened.createCheckpoint('unchanged')
    expect(await reopened.getChanges(current.hash, next.hash)).toEqual([])
  })
})
