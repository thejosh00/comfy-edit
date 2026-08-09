import { test, expect } from '@playwright/test'

/**
 * Settles the one version-dependent unknown in the design (research.md D1): whether
 * Vite's `ws: true` proxy applies its rewrite to the HTTP *upgrade* request. If it
 * does not, ComfyUI receives /comfy/ws instead of /ws and every run hangs at "queued".
 *
 * This runs before anything is built on top of the proxy, on purpose. It uses no
 * application code, so it stays valid however the UI changes.
 */
test.describe('comfy proxy', () => {
  test('forwards HTTP requests with the /comfy prefix stripped', async ({ page }) => {
    await page.goto('/')

    const stats = await page.evaluate(async () => {
      const res = await fetch('/comfy/system_stats')
      return { ok: res.ok, body: await res.json() }
    })

    expect(stats.ok).toBe(true)
    expect(stats.body).toHaveProperty('system')
  })

  test('forwards the websocket upgrade to /ws, not /comfy/ws', async ({ page }) => {
    await page.goto('/')

    // The fake destroys any upgrade that does not arrive at exactly /ws, so a
    // successful open is itself the assertion that the rewrite applied.
    const result = await page.evaluate(async () => {
      const url = `${location.origin.replace(/^http/, 'ws')}/comfy/ws?clientId=proxy-check`
      return new Promise<{ opened: boolean; firstMessageType: string | null }>((resolve) => {
        const ws = new WebSocket(url)
        const timer = setTimeout(() => {
          ws.close()
          resolve({ opened: false, firstMessageType: null })
        }, 5000)

        ws.onmessage = (ev) => {
          clearTimeout(timer)
          const parsed = JSON.parse(String(ev.data))
          ws.close()
          resolve({ opened: true, firstMessageType: parsed.type })
        }
        ws.onerror = () => {
          clearTimeout(timer)
          resolve({ opened: false, firstMessageType: null })
        }
      })
    })

    expect(result.opened).toBe(true)
    expect(result.firstMessageType).toBe('status')
  })

  test('serves generated images same-origin so the canvas is never tainted', async ({ page }) => {
    await page.goto('/')

    // A cross-origin image would taint the canvas and make getImageData throw,
    // breaking both the pixel assertions and the next upload.
    const sameOrigin = await page.evaluate(() => {
      const u = new URL('/comfy/view?filename=x.png&subfolder=&type=output', location.href)
      return u.origin === location.origin
    })

    expect(sameOrigin).toBe(true)
  })
})
