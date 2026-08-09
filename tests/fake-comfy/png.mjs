// Minimal PNG encoder/decoder over node:zlib. No dependencies, fully deterministic.
// Used to generate the teal test fixture and the fake server's magenta output.
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/**
 * Encode an RGBA image. `pixelAt(x, y)` returns [r, g, b, a].
 */
export function encodePng(width, height, pixelAt) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0 // filter type: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y)
      const p = rowStart + 1 + x * 4
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
      raw[p + 3] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export function solidPng(width, height, [r, g, b]) {
  return encodePng(width, height, () => [r, g, b, 255])
}

/**
 * Solid fill with a border, so a generated image is visibly distinct from a solid fixture.
 */
export function borderedPng(width, height, fill, border, borderWidth = 20) {
  return encodePng(width, height, (x, y) => {
    const onBorder =
      x < borderWidth || y < borderWidth || x >= width - borderWidth || y >= height - borderWidth
    const [r, g, b] = onBorder ? border : fill
    return [r, g, b, 255]
  })
}

/**
 * Read width and height out of a PNG's IHDR so generated output can match the input's size.
 * Returns null if the buffer is not a PNG.
 */
export function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

export { inflateSync }
