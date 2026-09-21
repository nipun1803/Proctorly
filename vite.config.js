import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    watch: {
      ignored: [
        '**/backend/**',
        '**/data/**',
        '**/sessions/**',
        '**/*.json',
        '**/*.jsonl',
        '**/*.tmp',
        '**/app/**',
        '**/dist/**',
        '**/.system_generated/**'
      ]
    },
    proxy: {
      '/exam': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
