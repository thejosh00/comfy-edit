import { test, expect, type APIRequestContext } from '@playwright/test'
import { get } from 'node:http'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FAKE, resetFake } from './helpers'

/**
 * Another website open in the same browser can make it send requests here. These
 * drive the dev server the way such a page would — no application code — and
 * check that nothing is written to disk and nothing reaches ComfyUI.
 *
 * "Reaches ComfyUI" is read from the fake's own log of what arrived, so a guard
 * that ran after the proxy (which rewrites Origin, so ComfyUI would accept it)
 * fails here rather than passing on the status code alone.
 */

const REFUSED = 'Refused: this request came from another website.'

/** The two ways a browser reveals a cross-site request: new browsers, then old. */
const CROSS_SITE: Array<[string, Record<string, string>]> = [
  ['Sec-Fetch-Site: cross-site', { 'Sec-Fetch-Site': 'cross-site' }],
  ['a foreign Origin and no Sec-Fetch-Site', { Origin: 'https://evil.example' }],
]

/** What a page can send without a preflight: a text/plain POST. */
const PROMPT = JSON.stringify({ prompt: { '1': { class_type: 'X', inputs: {} } }, client_id: 'c' })

async function seenByComfy(request: APIRequestContext): Promise<string[]> {
  return (await (await request.get(`${FAKE}/__test/seen`)).json()).seen
}

/** A WebSocket handshake by hand: resolves the status line's code (101 = opened). */
function handshake(baseURL: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = get(`${baseURL}/comfy/ws?clientId=x`, {
      headers: {
        ...headers,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    })
    req.on('upgrade', (res, socket) => {
      socket.destroy()
      resolve(res.statusCode ?? 0)
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
  })
}

test.describe('requests from other websites', () => {
  let dir: string
  const save = (name: string) =>
    `/local/save?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`

  test.beforeEach(async ({ request }) => {
    dir = mkdtempSync(join(tmpdir(), 'comfy-edit-cross-site-'))
    await resetFake(request)
  })

  test.afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  for (const [how, headers] of CROSS_SITE) {
    test(`a cross-site POST to /comfy/prompt (${how}) gets 403 and never reaches ComfyUI`, async ({
      request,
    }) => {
      const res = await request.post('/comfy/prompt', {
        headers: { ...headers, 'Content-Type': 'text/plain' },
        data: PROMPT,
      })

      expect(res.status()).toBe(403)
      expect(await res.text()).toBe(REFUSED)
      expect(await seenByComfy(request)).toEqual([])
    })

    test(`a cross-site POST to /local/save (${how}) gets 403 and writes no file`, async ({
      request,
    }) => {
      const res = await request.post(save('planted.png'), {
        headers: { ...headers, 'Content-Type': 'text/plain' },
        data: 'bytes of the page\'s choosing',
      })

      expect(res.status()).toBe(403)
      expect(await res.text()).toBe(REFUSED)
      expect(readdirSync(dir)).toEqual([])
    })
  }

  test('a cross-site WebSocket to /comfy/ws is refused and ComfyUI sees no upgrade', async ({
    request,
    baseURL,
  }) => {
    for (const [how, headers] of CROSS_SITE) {
      // 404, not 403: Vite's proxy answers a refused upgrade itself (see vite.config.ts).
      expect(await handshake(baseURL!, headers), how).toBe(404)
    }
    expect(await seenByComfy(request)).toEqual([])
  })

  test('a same-site neighbour (another port on this machine) is refused too', async ({
    request,
  }) => {
    const res = await request.post(save('planted.png'), {
      headers: { 'Sec-Fetch-Site': 'same-site' },
      data: 'bytes',
    })

    expect(res.status()).toBe(403)
    expect(readdirSync(dir)).toEqual([])
  })

  test('same-origin and header-less requests still pass, and ComfyUI sees them', async ({
    request,
    baseURL,
  }) => {
    // Header-less: curl, and every other spec in this suite.
    const bare = await request.post(save('bare.png'), { data: 'bytes' })
    expect(bare.status()).toBe(200)

    // The app's own page, as a new browser and as an old one describe it.
    const own = await request.post(save('own.png'), {
      headers: { 'Sec-Fetch-Site': 'same-origin', Origin: baseURL! },
      data: 'bytes',
    })
    expect(own.status()).toBe(200)
    expect(readdirSync(dir).sort()).toEqual(['bare.png', 'own.png'])

    const proxied = await request.post('/comfy/prompt', {
      headers: { Origin: baseURL!, 'Content-Type': 'text/plain' },
      data: PROMPT,
    })
    // ComfyUI's own answer, not ours: the fake turns down a graph naming no uploaded
    // image. Getting that far is the point — the guard let it through to the proxy.
    expect(proxied.status()).toBe(400)
    expect(await proxied.text()).toContain('contract: graph references no uploaded image')

    expect(await handshake(baseURL!, {})).toBe(101)
    expect(await handshake(baseURL!, { Origin: baseURL! })).toBe(101)

    // The same log the refusals above read as empty: it does record what arrives.
    expect(await seenByComfy(request)).toEqual(['POST /prompt', 'UPGRADE /ws', 'UPGRADE /ws'])
  })
})
