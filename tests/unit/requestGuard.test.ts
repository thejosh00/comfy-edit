import { describe, it, expect } from 'vitest'
import { isCrossSite } from '../../src/server/requestGuard'

const HOST = '127.0.0.1:5173'
const req = (method: string, headers: Record<string, string>) => ({
  method,
  headers: { host: HOST, ...headers },
})

describe('isCrossSite', () => {
  it.each([
    ['cross-site', 'POST'],
    ['cross-site', 'GET'],
    ['same-site', 'POST'], // another port on localhost is same-site, and is not this app
    ['something-new', 'POST'], // unrecognised values are refused, not waved through
  ])('refuses Sec-Fetch-Site: %s on a %s', (site, method) => {
    expect(isCrossSite(req(method, { 'sec-fetch-site': site }))).toBe(true)
  })

  it.each(['same-origin', 'none'])('lets Sec-Fetch-Site: %s through', (site) => {
    expect(isCrossSite(req('POST', { 'sec-fetch-site': site }))).toBe(false)
  })

  it('trusts Sec-Fetch-Site over Origin when both are present', () => {
    const headers = { 'sec-fetch-site': 'cross-site', origin: `http://${HOST}` }
    expect(isCrossSite(req('POST', headers))).toBe(true)
  })

  it.each(['https://evil.example', 'http://127.0.0.1:9999', 'http://localhost:5173', 'null'])(
    'without Sec-Fetch-Site, refuses a POST whose Origin is %s',
    (origin) => {
      expect(isCrossSite(req('POST', { origin }))).toBe(true)
    },
  )

  it.each([`http://${HOST}`, `https://${HOST}`])(
    'without Sec-Fetch-Site, lets a POST from its own origin %s through',
    (origin) => {
      expect(isCrossSite(req('POST', { origin }))).toBe(false)
    },
  )

  it('without Sec-Fetch-Site, lets a plain GET through whatever its Origin', () => {
    expect(isCrossSite(req('GET', { origin: 'https://evil.example' }))).toBe(false)
  })

  it('without Sec-Fetch-Site, refuses a WebSocket handshake (a GET) from a foreign Origin', () => {
    const headers = { origin: 'https://evil.example', upgrade: 'websocket' }
    expect(isCrossSite(req('GET', headers))).toBe(true)
    expect(isCrossSite(req('GET', { origin: `http://${HOST}`, upgrade: 'websocket' }))).toBe(false)
  })

  it('lets a request with neither header through (curl, the test suite)', () => {
    expect(isCrossSite(req('POST', {}))).toBe(false)
    expect(isCrossSite(req('GET', { upgrade: 'websocket' }))).toBe(false)
  })
})
