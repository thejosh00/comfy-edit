/**
 * Colour sampled off the canvas. Pure, so the eyedropper's actual logic is
 * unit-tested without a DOM — CanvasStage only reads the pixel and hands it here.
 */

function channel(value: number): string {
  // Rounded and clamped: getImageData returns bytes, but a caller with a float or
  // an out-of-range value should still produce a formatted colour rather than
  // "NaN" or a seven-digit string.
  const byte = Math.max(0, Math.min(255, Math.round(value)))
  return byte.toString(16).padStart(2, '0')
}

/**
 * Lowercase `#rrggbb`. An `<input type="color">` silently ignores anything else
 * and keeps its previous value, so the exact shape matters.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/**
 * The colour of one sampled pixel, or null if there is nothing there to sample.
 *
 * A fully transparent pixel is null rather than black: an image with an alpha
 * channel has holes, and clicking one should leave the current colour alone
 * instead of quietly setting the brush to black.
 */
export function sampledColor(rgba: ArrayLike<number>): string | null {
  if (rgba.length < 4) return null
  if (rgba[3] === 0) return null
  return rgbToHex(rgba[0]!, rgba[1]!, rgba[2]!)
}
