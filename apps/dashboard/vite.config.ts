import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const browserInternerModules = {
  'node:util': fileURLToPath(new URL('./src/interner-node-util-browser.ts', import.meta.url)),
  'node:url': fileURLToPath(new URL('./src/interner-node-url-browser.ts', import.meta.url)),
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/chatgpt-export-reader/' : '/',
  plugins: [preact()],
  resolve: { alias: browserInternerModules },
})
