const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../resources/sandbox-runtime')
async function buildAppContainer() {
  if (process.platform !== 'win32') throw new Error('请在 Windows 上编译 AppContainer 宿主。')
  await fs.mkdir(path.join(root, 'bin'), { recursive: true })
  const executable = path.join(root, 'bin/pi-agenda-appcontainer.exe')
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const source = path.join(root, 'AppContainerRunner.cs')
  const result = spawnSync(compiler, ['/nologo', '/optimize+', '/platform:x64', '/out:' + executable, source], { windowsHide: true, encoding: 'utf8' })
  if (result.status !== 0 || result.error) throw new Error('AppContainer 宿主编译失败：' + (result.error?.message || result.stdout || result.stderr))
  const digest = file => fs.readFile(file).then(bytes => createHash('sha256').update(bytes).digest('hex'))
  await fs.writeFile(path.join(root, 'appcontainer-manifest.json'), JSON.stringify({ version: 1, source: await digest(source), executable: await digest(executable) }, null, 2) + '\n')
  console.log('AppContainer 宿主已编译并生成校验清单。')
}
if (require.main === module) buildAppContainer().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { buildAppContainer }
