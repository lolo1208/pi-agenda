const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')

// 固定版本，仅从经过校验的本地 Codex 运行时复制命令沙箱，不调用模型或读取登录凭据。
const version = '0.159.2'
const checksum = '52f75c649bebb8001102a1dd129c1ea6d02b0940321e6d7e82ee0526753bd58a'
const helpers = {
  'codex-command-runner.exe': 'f9cdc39dc02c2208ecb65a7a4849b26ac1c368c35741eb015e448d0bfcd77159',
  'codex-windows-sandbox-setup.exe': '7efc654885230814c9499cf6b95f0c1aabae5c6f344ac70e2f57437c512f42b7'
}
async function verifySandboxRuntime(directory) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  if (manifest.version !== version || manifest.platform !== 'win32' || manifest.arch !== 'x64' || manifest.files?.['bin/codex.exe'] !== checksum) throw new Error('命令沙箱运行时清单不匹配。')
  const hash = createHash('sha256')
  for await (const chunk of require('node:fs').createReadStream(path.join(directory, 'bin/codex.exe'))) hash.update(chunk)
  if (hash.digest('hex') !== checksum) throw new Error('命令沙箱运行时校验失败。')
  for (const [name, expected] of Object.entries(helpers)) {
    const hash = createHash('sha256')
    for await (const chunk of require('node:fs').createReadStream(path.join(directory, 'bin', name))) hash.update(chunk)
    if (hash.digest('hex') !== expected || manifest.files?.['bin/' + name] !== expected) throw new Error('安全配置辅助程序校验失败：' + name)
  }
  await fs.access(path.join(directory, 'LICENSE'))
  await fs.access(path.join(directory, 'NOTICE'))
  const appcontainer = JSON.parse(await fs.readFile(path.join(directory, 'appcontainer-manifest.json'), 'utf8'))
  for (const [name, expected] of [['AppContainerRunner.cs', appcontainer.source], ['bin/pi-agenda-appcontainer.exe', appcontainer.executable]]) {
    const bytes = await fs.readFile(path.join(directory, name))
    if (appcontainer.version !== 1 || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('AppContainer 宿主校验失败：' + name)
  }
}
async function prepareSandboxRuntime(source) {
  if (!source) throw new Error('请传入本地 Codex 0.159.2 运行时目录。')
  const metadata = JSON.parse(await fs.readFile(path.join(source, 'codex-package.json'), 'utf8'))
  if (metadata.version !== version || metadata.target !== 'x86_64-pc-windows-msvc' || metadata.entrypoint !== 'bin/codex.exe') throw new Error('命令沙箱运行时版本或平台不匹配。')
  const destination = path.resolve(__dirname, '../resources/sandbox-runtime')
  await fs.mkdir(path.join(destination, 'bin'), { recursive: true })
  const data = await fs.readFile(path.join(source, 'bin/codex.exe'))
  if (createHash('sha256').update(data).digest('hex') !== checksum) throw new Error('源运行时校验失败，未复制。')
  await fs.writeFile(path.join(destination, 'bin/codex.exe'), data)
  const files = { 'bin/codex.exe': createHash('sha256').update(await fs.readFile(path.join(destination, 'bin/codex.exe'))).digest('hex') }
  for (const [name, expected] of Object.entries(helpers)) {
    const data = await fs.readFile(path.join(source, 'codex-resources', name))
    if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error('源辅助程序校验失败：' + name)
    await fs.writeFile(path.join(destination, 'bin', name), data)
    files['bin/' + name] = expected
  }
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ version, platform: 'win32', arch: 'x64', files }, null, 2) + '\n')
  await require('./build-appcontainer.cjs').buildAppContainer()
  await verifySandboxRuntime(destination)
  console.log('Windows 安全执行运行时与配置程序已准备。')
}
if (require.main === module) prepareSandboxRuntime(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { prepareSandboxRuntime, verifySandboxRuntime }
