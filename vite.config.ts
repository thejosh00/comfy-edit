/// <reference types="vitest" />
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = process.env.COMFY_URL || env.COMFY_URL || 'http://127.0.0.1:8188'

  // Same object for `server` and `preview`: `vite preview` ignores server.proxy.
  const proxy: Record<string, ProxyOptions> = {
    '/comfy': {
      target,
      changeOrigin: true,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/comfy/, ''),
    },
  }

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    test: {
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
    },
  }
})
