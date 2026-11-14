/**
 * Keeps other websites out of /comfy/* and /local/*.
 *
 * A page on any site can make the browser send a request to this dev server, and
 * the proxy then rewrites Origin so ComfyUI cannot tell. So the question "did this
 * come from the app's own page?" is answered here, before either route acts.
 */
import type { IncomingMessage } from 'node:http'

export const CROSS_SITE_MESSAGE = 'Refused: this request came from another website.'

/** True when the request comes from a page that is not this server's own. */
export function isCrossSite(req: Pick<IncomingMessage, 'method' | 'headers'>): boolean {
  // Browsers that send Sec-Fetch-Site say outright where the request came from.
  // 'none' is the user typing the address; anything unrecognised is refused.
  const site = req.headers['sec-fetch-site']
  if (site !== undefined) return site !== 'same-origin' && site !== 'none'

  // Older browsers: fall back to Origin, which they send on anything that can
  // change state. A plain GET is let through (an <img> sends no Origin at all);
  // a WebSocket handshake is a GET too, but it opens a channel, so it is checked.
  const origin = req.headers.origin
  if (origin === undefined) return false // curl, the tests: not a browser
  if (req.method === 'GET' && !req.headers.upgrade) return false
  const host = req.headers.host
  return origin !== `http://${host}` && origin !== `https://${host}`
}
