import type { ChatAttachment } from './models'

export const ATTACHMENT_DATA_URL = /^data:([a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/
export type AttachmentKind = 'image' | 'text' | 'audio' | 'video' | 'file'
const decodedText = new WeakMap<ChatAttachment, string>()
const textExtensions = new Set('txt md markdown csv tsv json jsonl xml html htm css scss less js jsx ts tsx mjs cjs py rb rs go java c cpp h hpp cs swift kt sh bash ps1 bat cmd sql yaml yml toml ini cfg conf log env gitignore dockerfile svg srt vtt tex'.split(' '))
const mimeByExtension: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const extension = (name: string): string => name.toLowerCase().split('.').at(-1) ?? ''

export function attachmentMime(name: string, supplied = ''): string {
  if (textExtensions.has(extension(name)) || /^(readme|license|dockerfile|makefile)$/i.test(name)) return 'text/plain'
  if (mimeByExtension[extension(name)]) return mimeByExtension[extension(name)]
  return /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(supplied) ? supplied.toLowerCase() : 'application/octet-stream'
}

export function attachmentKind(file: ChatAttachment): AttachmentKind {
  const mime = file.dataUrl.slice(5, file.dataUrl.indexOf(';')).toLowerCase()
  if (mime === 'image/svg+xml' || mime.startsWith('text/') || textExtensions.has(extension(file.name)) || ['application/json', 'application/xml', 'application/javascript', 'application/x-yaml'].includes(mime)) return 'text'
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/x-icon', 'image/avif'].includes(mime)) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

export function attachmentBytes(file: ChatAttachment): Uint8Array {
  return Uint8Array.from(atob(file.dataUrl.slice(file.dataUrl.indexOf(',') + 1)), character => character.charCodeAt(0))
}

export function attachmentText(file: ChatAttachment): string {
  const cached = decodedText.get(file)
  if (cached !== undefined) return cached
  const bytes = attachmentBytes(file)
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  let text: string
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch { text = new TextDecoder('gb18030').decode(bytes) }
  decodedText.set(file, text)
  return text
}

export function attachmentSize(file: ChatAttachment): number {
  const data = file.dataUrl.slice(file.dataUrl.indexOf(',') + 1)
  return data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
}

export function formatAttachmentSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`
}
