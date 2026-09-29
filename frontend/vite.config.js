import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Conservar Host permite a la API validar el Origin del navegador.
const proxy = { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } }

export default defineConfig({
  server: { proxy },
  preview: { proxy },
  plugins: [
    react(),
    tailwindcss(),
  ],
})
