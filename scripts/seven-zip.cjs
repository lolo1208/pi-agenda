const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const { spawn } = require('node:child_process')
const { availableParallelism } = require('node:os')
const manifest = require('./nsis-x64-manifest.json').extractor

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'inherit', windowsHide: true, ...options })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(file)} 执行失败（退出码：${code}）`)))
  })
}

let preparing
function getSevenZip(projectDir) {
  preparing ??= prepare(projectDir).catch(error => { preparing = undefined; throw error })
  return preparing
}

async function prepare(projectDir) {
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const appRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { GotDownloader } = appRequire('@electron/get/dist/cjs/GotDownloader')
  const { buildGotProxyAgent } = builderRequire('builder-util')
  const { getPath7za } = builderRequire('app-builder-lib/out/toolsets/7zip')
  const lockfile = appRequire('proper-lockfile')
  const root = path.join(projectDir, 'build-work', 'tools')
  await fs.mkdir(root, { recursive: true })
  const archive = path.join(root, `7zip-${manifest.version}-x64.exe`)
  const release = await lockfile.lock(root, {
    lockfilePath: `${archive}.lock`,
    retries: { retries: 100, minTimeout: 1000, maxTimeout: 3000 }, stale: 120_000,
  })
  try {
    const valid = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex') === manifest.sha256
    if (!await valid(archive).catch(() => false)) {
      const temporary = `${archive}.${process.pid}.download`
      try {
        console.log(`正在下载 7-Zip ${manifest.version}……`)
        await new GotDownloader().download(manifest.url, temporary, {
          quiet: true, timeout: { request: 300_000 }, retry: { limit: 0 }, agent: buildGotProxyAgent(),
        })
        if (!await valid(temporary)) throw new Error('7-Zip 下载文件 SHA-256 校验失败')
        await fs.rename(temporary, archive)
      } finally {
        await fs.rm(temporary, { force: true })
      }
    }
    const directory = path.join(root, `7zip-${manifest.version}-x64`)
    const verifyFiles = async () => {
      for (const [name, checksum] of Object.entries(manifest.files)) {
        const data = await fs.readFile(path.join(directory, name))
        if (createHash('sha256').update(data).digest('hex') !== checksum) throw new Error(`7-Zip 工具文件校验失败：${name}`)
      }
    }
    // 校验缓存，避免其他打包进程正在使用工具时重复覆盖可执行文件。
    if (!await verifyFiles().then(() => true, () => false)) {
      await run(await getPath7za(), ['x', '-y', '-bd', '-bso0', archive, `-o${directory}`, ...Object.keys(manifest.files)])
      await verifyFiles()
    }
    return { directory, executable: path.join(directory, '7z.exe') }
  } finally {
    await release()
  }
}

async function compressDirectory({ projectDir, stagingDir, zip = false }) {
  const started = performance.now()
  const tool = await getSevenZip(projectDir)
  const output = path.join(stagingDir, zip ? 'pi-agenda-portable.zip' : 'app-payload.7z')
  // 先移除旧压缩包，防止增量更新残留已经从应用删除的文件。
  await fs.rm(output, { force: true })
  console.log(`正在使用多线程生成 ${path.basename(output)}……`)
  await run(tool.executable, [
    'a', zip ? '-tzip' : '-t7z', '-mx=5', `-mmt=${availableParallelism()}`, '-bd', '-bso0',
    ...(zip ? ['-mm=Deflate'] : ['-m0=LZMA2', '-ms=on']), output, '.',
  ], { cwd: path.join(stagingDir, 'win-unpacked') })
  console.log(`${path.basename(output)} 已生成，用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒`)
  return output
}

module.exports = { run, getSevenZip, compressDirectory }
