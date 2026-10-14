import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'esbuild'

const monacoNlsShim = fileURLToPath(new URL('./src/renderer/src/lib/monaco-nls-zh.ts', import.meta.url))
const monacoEsmDirectory = /monaco-editor[\\/]esm[\\/]vs[\\/]/

/** Monaco 内部一律用相对路径导入 nls.js，按导入方路径判断即可避免影响其他依赖。 */
function isMonacoNlsImport(source: string, importer?: string): boolean {
  return Boolean(importer) && source.endsWith('nls.js') && monacoEsmDirectory.test(importer!)
}

/** 预打包 monaco-editor 时同样替换语言模块，避免开发模式回落到英文提示。 */
const monacoNlsEsbuildPlugin: Plugin = {
  name: 'monaco-chinese-nls',
  setup(build) {
    build.onResolve({ filter: /nls\.js$/ }, args => isMonacoNlsImport(args.path, args.importer) ? { path: monacoNlsShim } : null)
  }
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { output: { format: 'es', entryFileNames: 'index.mjs' } } } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)) } },
    optimizeDeps: { esbuildOptions: { plugins: [monacoNlsEsbuildPlugin] } },
    plugins: [react(), tailwindcss(), {
      // 把 Monaco 的语言模块换成中文文案，避免界面里出现内置英文提示。
      name: 'monaco-chinese-nls',
      enforce: 'pre',
      resolveId(source, importer) {
        return isMonacoNlsImport(source, importer) ? monacoNlsShim : null
      }
    }, {
      name: 'development-refresh-csp',
      apply: 'serve',
      transformIndexHtml: html => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    }]
  }
})
