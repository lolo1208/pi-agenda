const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')

// 只提交版本和校验信息；Windows 打包时才准备工具。
const compilerManifest = require('./nsis-x64-manifest.json')
const compilerVersion = compilerManifest.version
const archiveName = `nsis-${compilerVersion}-negrutiu-amd64.exe`
const archiveUrl = `https://github.com/negrutiu/nsis/releases/download/v${compilerVersion}/${archiveName}`
const preparingCompilers = new Map()

async function assertX64(file) {
  const handle = await fs.open(file, 'r')
  try {
    const header = Buffer.alloc(64)
    await handle.read(header, 0, 64, 0)
    if (header.readUInt16LE(0) !== 0x5a4d) throw new Error(`文件不是 Windows 程序：${file}`)
    const pe = Buffer.alloc(6)
    await handle.read(pe, 0, 6, header.readUInt32LE(0x3c))
    if (pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) {
      throw new Error(`程序架构不是 x64：${file}`)
    }
  } finally {
    await handle.close()
  }
}

async function verifyCompiler(toolDir) {
  const compiler = path.join(toolDir, 'Bin', 'makensis.exe')
  for (const [relative, checksum] of Object.entries(compilerManifest.files)) {
    const data = await fs.readFile(path.join(toolDir, relative))
    if (createHash('sha256').update(data).digest('hex') !== checksum) {
      throw new Error(`打包工具文件校验失败：${relative}`)
    }
  }
  await assertX64(compiler)
  return compiler
}

async function prepareCompiler(projectDir) {
  const cacheRoot = path.resolve(projectDir, 'build-work', 'tools')
  const toolDir = path.join(cacheRoot, `nsis-x64-${compilerVersion}`)
  try {
    return await verifyCompiler(toolDir)
  } catch {
    // 缓存缺失或损坏时重新准备；有效缓存可离线复用。
  }
  // 复用 electron-builder 的下载与解压依赖，无需系统安装 7-Zip。
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { GotDownloader } = appBuilderRequire('@electron/get/dist/cjs/GotDownloader')
  const { getPath7za } = builderRequire('app-builder-lib/out/toolsets/7zip')
  const { buildGotProxyAgent } = builderRequire('builder-util')
  const lockfile = appBuilderRequire('proper-lockfile')
  await fs.mkdir(cacheRoot, { recursive: true })
  const release = await lockfile.lock(cacheRoot, {
    lockfilePath: `${toolDir}.lock`,
    retries: { retries: 100, minTimeout: 1000, maxTimeout: 3000 },
    stale: 120_000,
  })
  let temporaryDir
  try {
    try {
      return await verifyCompiler(toolDir)
    } catch {
      // 另一打包进程可能已经完成下载，取得锁后再次检查。
    }
    temporaryDir = await fs.mkdtemp(path.join(cacheRoot, '.nsis-download-'))
    const archive = path.join(temporaryDir, archiveName)
    console.log(`正在下载 Windows x64 打包工具 NSIS ${compilerVersion}……`)
    const downloader = new GotDownloader()
    async function downloadVerified(url, destination, checksum) {
      await downloader.download(url, destination, {
        quiet: true,
        timeout: { request: 300_000 },
        retry: { limit: 0 },
        agent: buildGotProxyAgent(),
      })
      if (createHash('sha256').update(await fs.readFile(destination)).digest('hex') !== checksum) {
        throw new Error(`下载文件 SHA-256 校验失败：${path.basename(destination)}`)
      }
    }
    await downloadVerified(archiveUrl, archive, compilerManifest.archiveSha256)
    // electron-builder 的 7za 不含 NSIS 格式支持，用它解出官方完整 7-Zip。
    const extractorArchive = path.join(temporaryDir, '7zip.exe')
    const extractorDir = path.join(temporaryDir, '7zip')
    const extractor = compilerManifest.extractor
    console.log(`正在准备解压工具 7-Zip ${extractor.version}……`)
    await downloadVerified(extractor.url, extractorArchive, extractor.sha256)
    execFileSync(await getPath7za(), ['x', '-y', '-bd', extractorArchive, `-o${extractorDir}`], {
      stdio: 'pipe', windowsHide: true, timeout: 120_000,
    })
    const extracted = path.join(temporaryDir, 'extracted')
    execFileSync(path.join(extractorDir, '7z.exe'), ['x', '-y', '-bd', archive, `-o${extracted}`], {
      stdio: 'pipe', windowsHide: true, timeout: 120_000,
    })
    const prepared = path.join(temporaryDir, 'prepared')
    // 只缓存固定清单中的打包文件，包含许可证，不执行上游安装程序。
    for (const relative of Object.keys(compilerManifest.files)) {
      const destination = path.join(prepared, relative)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(path.join(extracted, relative), destination)
    }
    await verifyCompiler(prepared)
    await fs.rm(toolDir, { recursive: true, force: true })
    await fs.rename(prepared, toolDir)
    console.log(`Windows 打包工具已缓存到：${toolDir}`)
    return path.join(toolDir, 'Bin', 'makensis.exe')
  } catch (error) {
    throw new Error(`Windows 打包工具准备失败，请检查 GitHub 下载连接或代理后重新运行打包命令：${error.message}`, { cause: error })
  } finally {
    try {
      if (temporaryDir) await fs.rm(temporaryDir, { recursive: true, force: true })
    } finally {
      await release()
    }
  }
}

async function getCompiler(projectDir) {
  if (process.platform !== 'win32') throw new Error('Windows 打包工具仅在 Windows 打包时下载。')
  const key = path.resolve(projectDir)
  if (!preparingCompilers.has(key)) {
    preparingCompilers.set(key, prepareCompiler(key).finally(() => preparingCompilers.delete(key)))
  }
  return preparingCompilers.get(key)
}

async function packageWindows({ projectDir, stagingDir, portable }) {
  const metadata = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'))
  const appName = metadata.build.productName
  const executableName = metadata.build.win?.executableName ?? metadata.build.executableName ?? appName
  const appExe = `${executableName}.exe`
  const unpacked = path.join(stagingDir, 'win-unpacked')
  await assertX64(path.join(unpacked, appExe))
  const compiler = await getCompiler(projectDir)
  const output = path.join(stagingDir, portable ? 'pi-agenda-portable.exe' : 'pi-agenda-setup.exe')
  const args = [
    '/V2', '/INPUTCHARSET', 'UTF8',
    `/DAPP_NAME=${appName}`, `/DAPP_EXE=${appExe}`, `/DAPP_VERSION=${metadata.version}`,
    `/DAPP_DIRECTORY_NAME=${executableName}`,
    `/DAPP_DIR=${unpacked}`, `/DOUTPUT_FILE=${output}`,
    `/DAPP_ICON=${path.join(projectDir, 'resources', 'icons', 'icon.ico')}`,
  ]
  if (portable) {
    args.push('/DPORTABLE')
  } else {
    const uninstallLines = []
    const escapeNsis = value => value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"')
    async function collectFiles(directory, relative = '') {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const childRelative = path.join(relative, entry.name)
        if (entry.isDirectory()) {
          await collectFiles(path.join(directory, entry.name), childRelative)
          uninstallLines.push(`RMDir "$INSTDIR\\${escapeNsis(childRelative)}"`)
        } else if (entry.isFile()) {
          uninstallLines.push(`Delete "$INSTDIR\\${escapeNsis(childRelative)}"`)
        } else {
          throw new Error(`打包目录存在不支持的文件类型：${childRelative}`)
        }
      }
    }
    await collectFiles(unpacked)
    const uninstallFile = path.join(stagingDir, 'uninstall-files.nsh')
    await fs.writeFile(uninstallFile, uninstallLines.join('\n') + '\n', 'utf8')
    args.push(`/DUNINSTALL_FILES=${uninstallFile}`)
  }
  args.push(path.join(projectDir, 'scripts', 'native-windows.nsi'))
  console.log(`正在生成原生 x64 ${portable ? '便携版' : '安装包'}……`)
  execFileSync(compiler, args, { stdio: 'inherit', env: { ...process.env, NSISDIR: path.dirname(path.dirname(compiler)) } })
  await assertX64(output)
  return output
}

module.exports = { assertX64, getCompiler, packageWindows }
