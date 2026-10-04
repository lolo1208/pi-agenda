const { spawn } = require('node:child_process')
const path = require('node:path')

// electron-vite checks path.txt before Electron's lazy installer can run.
// Use Electron's own installer to retain its cache and checksum verification.
const installer = path.join(path.dirname(require.resolve('electron/package.json')), 'install.js')
const environment = { ...process.env }
const hasProxy = Object.entries(environment).some(([name, value]) => /^(http|https)_proxy$/i.test(name) && value)
if (hasProxy && environment.ELECTRON_GET_USE_PROXY === undefined) environment.ELECTRON_GET_USE_PROXY = '1'

const child = spawn(process.execPath, [installer], { env: environment, stdio: 'inherit', windowsHide: true })
const timeout = setTimeout(() => {
  console.error('Electron 运行时安装超过 5 分钟，请检查 GitHub 下载连接或代理后运行 pnpm electron:install 重试。')
  child.kill()
}, 300_000)
child.on('error', () => {
  clearTimeout(timeout)
  console.error('无法启动 Electron 安装程序，请先运行 pnpm install --frozen-lockfile。')
  process.exitCode = 1
})
child.on('exit', code => {
  clearTimeout(timeout)
  if (code !== 0) console.error('Electron 运行时尚未就绪，修复下载问题后请运行 pnpm electron:install。')
  process.exitCode = code === 0 ? 0 : 1
})
