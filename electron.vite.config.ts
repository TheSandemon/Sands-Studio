import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        // @iconify/utils@3.1.0 references this file which doesn't exist in the package.
        // Stub it out so the build succeeds — Mermaid doesn't use emoji parsing at runtime.
        '@iconify/utils/lib/emoji/test/parse': path.resolve(__dirname, 'src/stubs/empty.js'),
      }
    }
  }
})
