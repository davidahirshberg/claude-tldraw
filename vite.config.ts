import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/claude-tldraw/',
  plugins: [react()],
  server: {
    host: true, // Expose on all network interfaces
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
})
