import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  cacheDir: '.vite-cache',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['essentia.js/dist/essentia.js-core.es.js', 'essentia.js/dist/essentia-wasm.es.js'] },
})
