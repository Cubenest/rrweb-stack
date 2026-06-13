import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // '/' for dev + the standalone deploy; '/demo/' when bundled under peek.cubenest.in/demo
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
})
