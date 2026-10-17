import { realpath, stat, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { literalCommand } from './windows-command-parser'
import path from 'node:path'
import os from 'node:os'

const runtimes = ['node', 'npm', 'npx', 'pnpm', 'corepack', 'yarn', 'git', 'cargo', 'rustc', 'rustup', 'python', 'python3', 'py', 'dotnet', 'go', 'java', 'javac', 'protoc']
const rustupHome = (env: NodeJS.ProcessEnv): string => env.RUSTUP_HOME ?? path.join(env.USERPROFILE ?? env.HOME ?? os.homedir(), '.rustup')
export const toolWithin = (root: string, value: string): boolean => { const relative = path.relative(root, value); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) }

/** 默认只读程序本体；可验证软件包可读取安装依赖，不开放宿主缓存、配置或任意 PATH 目录。 */
export async function developerToolReads(project: string, protectedDirectories: string[], env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const home = env.USERPROFILE ?? env.HOME ?? os.homedir()
  const broad = new Set([path.parse(home).root, home, path.dirname(project), env.APPDATA, env.LOCALAPPDATA, env.ProgramFiles, env.ProgramData].filter(Boolean).map(value => path.resolve(value!)))
  const roots = new Set<string>()
  const file = async (value: string): Promise<boolean> => { try { return (await stat(value)).isFile() } catch { return false } }
  const add = async (candidate: string): Promise<void> => {
    try {
      const actual = await realpath(candidate)
      if (broad.has(actual) || toolWithin(actual, project) || protectedDirectories.some(root => toolWithin(actual, root) || toolWithin(root, actual))) return
      roots.add(actual)
    } catch { /* 不自动安装不存在的运行时。 */ }
  }
  for (const directory of (env.PATH ?? '').split(path.delimiter).map(value => value.trim().replace(/^"|"$/g, '')).filter(Boolean)) {
    for (const runtime of runtimes) for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd', '.ps1'] : ['']) {
      const candidate = path.resolve(directory, runtime + suffix)
      if (!await file(candidate)) continue
      const installed = path.dirname(await realpath(candidate))
      const packaged = (await Promise.all(['node_modules/npm/package.json', 'node_modules/pnpm/package.json', 'node_modules/corepack/package.json', 'Lib/site.py', 'lib/rustlib/components'].map(marker => file(path.join(installed, marker))))).some(Boolean)
      const dedicated = /^(?:node(?:js|[-v][\w.-]+)?|npm|pnpm|corepack|Python[\d.]+)$/i.test(path.basename(installed))
      await add(packaged && dedicated && !broad.has(installed) ? installed : candidate)
      if (runtime === 'git' && await file(path.resolve(installed, '../mingw64/bin/git.exe'))) await add(path.resolve(installed, '../mingw64'))
      break
    }
  }
  // PNPM_HOME 可以不在当前 PATH；只放行启动文件及经标记验证的软件包，排除 store 和用户配置。
  for (const directory of [env.PNPM_HOME, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'pnpm')].filter((value): value is string => !!value)) {
    for (const name of ['pnpm.exe', 'pnpm.cmd', 'pnpm.ps1', 'pnpx.exe', 'pnpx.cmd']) if (await file(path.join(directory, name))) await add(path.join(directory, name))
    if (await file(path.join(directory, 'node_modules/pnpm/package.json'))) await add(path.join(directory, 'node_modules/pnpm'))
  }
  // Rust 工具链是安装程序，Cargo registry/git 是用户缓存，二者不混用权限。
  const cargoBin = path.join(home, '.cargo', 'bin')
  if (await file(path.join(cargoBin, 'rustup.exe')) && await file(path.join(cargoBin, 'cargo.exe'))) await add(cargoBin)
  const rustup = rustupHome(env)
  try {
    for (const toolchain of await readdir(path.join(rustup, 'toolchains'), { withFileTypes: true })) {
      if (!toolchain.isDirectory() || toolchain.isSymbolicLink()) continue
      const installed = path.join(rustup, 'toolchains', toolchain.name)
      if (await file(path.join(installed, 'bin', 'rustc.exe')) && await file(path.join(installed, 'lib', 'rustlib', 'components'))) await add(installed)
    }
  } catch { /* 没有 Rust 安装时不增加权限。 */ }
  // 仅开放已安装浏览器的可执行资源目录，不开放缓存根及其配置，也不授予写权限。
  for (const browserRoot of [path.join(home, '.cache', 'ms-playwright'), ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'ms-playwright')] : [])]) {
    try {
      for (const browser of await readdir(browserRoot, { withFileTypes: true })) {
        if (!browser.isDirectory() || browser.isSymbolicLink() || !/^(?:chromium|chromium_headless_shell|firefox|webkit)-\d+$/.test(browser.name)) continue
        for (const [folder, executable] of [['chrome-win', 'chrome.exe'], ['chrome-win64', 'chrome.exe'], ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'], ['firefox', 'firefox.exe']]) {
          const installed = path.join(browserRoot, browser.name, folder)
          if (await file(path.join(installed, executable))) await add(installed)
        }
      }
    } catch { /* 不下载或复制浏览器安装。 */ }
  }
  return [...roots].filter(value => ![...roots].some(parent => parent !== value && toolWithin(parent, value)))
}

/** 固定调用 rustup which 查询安装路径，不执行用户脚本、不自动安装工具链。 */
export async function rustToolInvocation(command: string, project: string, signal?: AbortSignal): Promise<{ command: string; env: NodeJS.ProcessEnv } | undefined> {
  const tokens = literalCommand(command)
  if (!tokens || /^['"]/.test(command.trim())) return undefined
  const name = path.basename(tokens[0]).replace(/\.exe$/i, '').toLowerCase()
  if (!['cargo', 'rustc', 'rustdoc'].includes(name)) return undefined
  const bin = path.join(os.homedir(), '.cargo', 'bin'), proxy = path.join(bin, name + '.exe')
  let located = tokens[0]
  if (!/[\\/]/.test(located)) {
    for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
      try { const candidate = path.join(entry, name + '.exe'); if ((await stat(candidate)).isFile()) { located = candidate; break } } catch { /* 继续查找。 */ }
    }
  }
  if (path.resolve(located).toLowerCase() !== path.resolve(proxy).toLowerCase()) return undefined
  const args = tokens.slice(1), selector = args[0]?.startsWith('+') ? args.shift()!.slice(1) : undefined
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['path', 'pathext', 'systemroot', 'windir', 'userprofile', 'homedrive', 'homepath', 'rustup_home', 'rustup_toolchain'].includes(key.toLowerCase())))
  const { stdout } = await promisify(execFile)(path.join(bin, 'rustup.exe'), ['which', ...(selector ? ['--toolchain', selector] : []), name], { cwd: project, env: { ...env, RUSTUP_AUTO_INSTALL: '0' }, windowsHide: true, signal, timeout: 10000 })
  const executable = await realpath(stdout.trim()), installed = path.dirname(path.dirname(executable))
  if (path.basename(executable).toLowerCase() !== name + '.exe' || !(await stat(path.join(installed, 'lib', 'rustlib', 'components'))).isFile()) throw new Error('Rust 工具链安装路径未通过校验')
  const quote = (value: string): string => "'" + value.replace(/'/g, "''") + "'"
  return { command: '& ' + [executable, ...args].map(quote).join(' '), env: { RUSTC: path.join(installed, 'bin/rustc.exe'), RUSTDOC: path.join(installed, 'bin/rustdoc.exe') } }
}
