const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')

// ICO 中嵌入多尺寸 PNG，适用于项目支持的 Windows 10/11。
function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16
    header[entry] = header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(data.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images.map(image => image.data)])
}

function encodeIcns(images) {
  const types = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' }
  const chunks = images.map(({ size, data }) => {
    const header = Buffer.alloc(8)
    header.write(types[size], 0, 'ascii')
    header.writeUInt32BE(8 + data.length, 4)
    return Buffer.concat([header, data])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

async function generateIcons(root = path.resolve(__dirname, '..')) {
  const source = path.join(root, 'resources', 'app-icon.png')
  const input = await fs.readFile(source).catch(error => {
    if (error.code === 'ENOENT') throw new Error(`找不到图标源文件，请将 PNG 放到：${source}`)
    throw error
  })
  const metadata = await sharp(input).metadata()
  if (metadata.format !== 'png') throw new Error('app-icon.png 必须是有效的 PNG 图片。')
  if ((metadata.pages ?? 1) > 1) throw new Error('请使用静态 PNG 图片，不支持动画 PNG。')

  // 每个尺寸直接从原图生成，保持比例、完整保留画布并居中补透明边。
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
  const images = await Promise.all(sizes.map(async size => ({
    size,
    data: await sharp(input).autoOrient().ensureAlpha().resize(size, size, {
      fit: 'contain', position: 'centre', background: { r: 0, g: 0, b: 0, alpha: 0 }
    }).png().toBuffer()
  })))
  const imageAt = size => images.find(image => image.size === size).data
  const resources = path.join(root, 'resources', 'icons')
  const publicIcons = path.join(root, 'src', 'renderer', 'public', 'icons')
  // 先完成输入校验和全部编码，再覆盖已有资源；不修改源图片。
  const ico = encodeIco(images.filter(image => image.size <= 256))
  const icns = encodeIcns(images.filter(image => ![24, 48].includes(image.size)))
  const favicon = encodeIco(images.filter(image => [16, 32, 48].includes(image.size)))
  await Promise.all([fs.mkdir(resources, { recursive: true }), fs.mkdir(publicIcons, { recursive: true })])
  await Promise.all([
    ...images.map(({ size, data }) => fs.writeFile(path.join(resources, `icon-${size}.png`), data)),
    fs.writeFile(path.join(resources, 'icon.png'), imageAt(1024)),
    fs.writeFile(path.join(resources, 'icon.ico'), ico),
    fs.writeFile(path.join(resources, 'icon.icns'), icns),
    fs.writeFile(path.join(publicIcons, 'app-icon.png'), imageAt(256)),
    fs.writeFile(path.join(publicIcons, 'favicon.ico'), favicon)
  ])
  return { width: metadata.width, height: metadata.height, resources, publicIcons }
}

if (require.main === module) {
  generateIcons().then(({ width, height }) => {
    console.log(`图标已更新：源图 ${width} × ${height}，保持比例并居中补透明留白。`)
    console.log('已生成 resources/icons 下的 PNG、ICO、ICNS，以及页面 Logo 和 favicon。')
  }).catch(error => {
    console.error(`图标生成失败：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { generateIcons }
