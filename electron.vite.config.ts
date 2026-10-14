import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { output: { format: 'es', entryFileNames: 'index.mjs' } } } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)) } },
    plugins: [react(), tailwindcss(), {
      name: 'development-refresh-csp',
      apply: 'serve',
      transformIndexHtml: html => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    }]
  }
})
