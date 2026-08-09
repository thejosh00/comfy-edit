/// <reference types="vitest" />
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = process.env.COMFY_URL || env.COMFY_URL || 'http://127.0.0.1:8188'

  const targetOrigin = new URL(target).origin

  // Same object for `server` and `preview`: `vite preview` ignores server.proxy.
  const proxy: Record<string, ProxyOptions> = {
    '/comfy': {
      target,
      changeOrigin: true,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/comfy/, ''),
      configure: (proxyServer) => {
        // ComfyUI (0.31+) rejects any request whose Origin header does not match
        // its own host — 403 on every route, not just writes. `changeOrigin`
        // rewrites Host but leaves Origin as the browser set it, so we have to
        // rewrite Origin ourselves or nothing but the dev server's own assets load.
        const setOrigin = (req: { setHeader(name: string, value: string): void }) => {
          req.setHeader('origin', targetOrigin)
        }
        proxyServer.on('proxyReq', setOrigin)
        proxyServer.on('proxyReqWs', setOrigin)
      },
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
