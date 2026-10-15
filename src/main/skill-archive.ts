import { createWriteStream } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32, deflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import { Open } from 'unzipper'
import { ModelError } from './models/model-validation'

const MAX_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 2000
const compress = promisify(deflateRaw)

/** 生成普通 UTF-8 ZIP，保留相对目录、空目录和脚本执行权限，可直接重新安装。 */
export async function createSkillArchive(root: string): Promise<Buffer> {
  const locals: Buffer[] = [], central: Buffer[] = []
  const canonicalRoot = await realpath(root)
  const seen = new Set<string>()
  let offset = 0, bytes = 0, count = 0
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++count > MAX_ENTRIES) throw new ModelError('技能包最多支持 2000 项')
      const input = path.join(directory, entry.name)
      const info = await lstat(input)
      if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) throw new ModelError('技能目录包含符号链接或不支持的文件类型，请移除后重试')
      const canonical = await realpath(input)
      if (!canonical.startsWith(canonicalRoot + path.sep)) throw new ModelError('不能导出技能目录以外的文件')
      const relative = `${prefix}${entry.name}${info.isDirectory() ? '/' : ''}`
      const target = archivePath(canonicalRoot, relative)
      const key = target.normalize('NFC').toLowerCase()
      if (seen.has(key)) throw new ModelError('技能包含重复路径或仅大小写不同的文件，请整理后重试')
      seen.add(key)
      bytes += info.size * Number(info.isFile())
      if (bytes > MAX_BYTES) throw new ModelError('技能目录不能超过 32 MiB')
      const content = info.isDirectory() ? Buffer.alloc(0) : await readFile(input)
      bytes += content.length - (info.isFile() ? info.size : 0)
      if (bytes > MAX_BYTES) throw new ModelError('技能目录不能超过 32 MiB')
      const packed = await compress(content), name = Buffer.from(relative, 'utf8'), checksum = crc32(content)
      if (name.length > 65535) throw new ModelError('技能文件路径过长，请缩短后重试')
      const modified = info.mtime
      const year = Math.max(1980, Math.min(2107, modified.getFullYear()))
      const date = ((year - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate()
      const time = (modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8)
      local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12)
      local.writeUInt32LE(checksum, 14); local.writeUInt32LE(packed.length, 18)
      local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26)
      const record = Buffer.alloc(46)
      record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6)
      record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10)
      record.writeUInt16LE(time, 12); record.writeUInt16LE(date, 14)
      record.writeUInt32LE(checksum, 16); record.writeUInt32LE(packed.length, 20)
      record.writeUInt32LE(content.length, 24); record.writeUInt16LE(name.length, 28)
      record.writeUInt32LE(((info.mode << 16) | (info.isDirectory() ? 0x10 : 0)) >>> 0, 38)
      record.writeUInt32LE(offset, 42)
      locals.push(local, name, packed); central.push(record, name)
      offset += local.length + name.length + packed.length
      if (info.isDirectory()) await visit(input, relative)
    }
  }
  await visit(canonicalRoot, '')
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  const archive = Buffer.concat([...locals, directory, end])
  if (archive.length > MAX_BYTES) throw new ModelError('技能 ZIP 压缩包不能超过 32 MiB')
  return archive
}
// unzipper 支持 tailSize；当前类型声明尚未包含该可选参数。
const openArchive: (file: string, options?: { tailSize: number }) => ReturnType<typeof Open.file> = Open.file

/** 同时按 Windows 和 POSIX 规则校验，避免同一压缩包在不同平台上越界。 */
function archivePath(root: string, name: string): string {
  const normalized = name.replace(/\\/g, '/')
  const parts = normalized.replace(/\/$/, '').split('/')
  if (!name || path.win32.isAbsolute(name) || path.posix.isAbsolute(normalized) || parts.some(part =>
    !part || part === '.' || part === '..' || /[\x00-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
  )) throw new ModelError('ZIP 包含不安全的解压路径，请检查压缩包后重试')
  const target = path.resolve(root, ...parts)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new ModelError('ZIP 文件不能解压到技能目录以外')
  return target
}

/** 仅写入新建的临时目录，逐个文件验证大小和校验和，不使用批量解压 API。 */
export async function extractSkillArchive(file: string, root: string): Promise<void> {
  const info = await lstat(file)
  if (!info.isFile() || info.size > MAX_BYTES) throw new ModelError('技能 ZIP 压缩包不能超过 32 MiB')
  // 在解析中央目录前限制声明的文件数量，支持带 ZIP 注释的压缩包。
  const handle = await open(file, 'r')
  const tail = Buffer.alloc(Math.min(info.size, 65557))
  try { await handle.read(tail, 0, tail.length, info.size - tail.length) }
  finally { await handle.close() }
  let end = tail.length - 22
  while (end >= 0 && (tail.readUInt32LE(end) !== 0x06054b50 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length)) end--
  if (end < 0) throw new ModelError('技能 ZIP 文件已损坏，请重新获取压缩包后安装')
  if (tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0 || tail.readUInt32LE(end + 16) === 0xffffffff) throw new ModelError('不支持分卷或 ZIP64 技能压缩包，请重新打包为普通 ZIP')
  if (tail.readUInt16LE(end + 10) > MAX_ENTRIES) throw new ModelError('技能 ZIP 最多支持 2000 项')
  const archive = await openArchive(file, { tailSize: tail.length - end })
  if (archive.files.length > MAX_ENTRIES) throw new ModelError('技能 ZIP 最多支持 2000 项')
  const seen = new Set<string>()
  let declaredBytes = 0, actualBytes = 0
  const entries = archive.files.map(entry => {
    const target = archivePath(root, entry.path)
    const key = target.normalize('NFC').toLowerCase()
    if (seen.has(key)) throw new ModelError('ZIP 包含重复路径或仅大小写不同的文件，请整理后重新安装')
    seen.add(key)
    const mode = (entry.externalFileAttributes >>> 16) & 0xf000
    if (mode !== 0 && mode !== 0x8000 && mode !== 0x4000) throw new ModelError('ZIP 不支持符号链接或特殊文件')
    if (entry.flags & 1) throw new ModelError('不支持加密的技能 ZIP，请先解密后重新安装')
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || (declaredBytes += entry.uncompressedSize) > MAX_BYTES) throw new ModelError('技能解压后的总大小不能超过 32 MiB')
    return { entry, target }
  })
  for (const { entry, target } of entries) {
    if (entry.type === 'Directory') { await mkdir(target, { recursive: true }); continue }
    await mkdir(path.dirname(target), { recursive: true })
    let bytes = 0, checksum = 0
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length; actualBytes += chunk.length
      if (bytes > entry.uncompressedSize || actualBytes > MAX_BYTES) { callback(new ModelError('技能 ZIP 解压大小超出限制')); return }
      checksum = crc32(chunk, checksum)
      callback(null, chunk)
    } })
    await pipeline(entry.stream(), limit, createWriteStream(target, { flags: 'wx' }))
    if (bytes !== entry.uncompressedSize || checksum !== entry.crc32) throw new ModelError('技能 ZIP 文件已损坏，请重新获取压缩包后安装')
  }
}
