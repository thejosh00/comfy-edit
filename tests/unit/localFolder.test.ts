import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { utimesSync } from 'node:fs'
import { resolve } from 'node:path'
import { listImages, resolveWithinRoot, contentTypeFor } from '../../src/server/localFolder'

const GALLERY = fileURLToPath(new URL('../fixtures/gallery', import.meta.url))

// Fixed rather than inherited from the checkout: the cap test below turns on
// which file is newer, and git does not preserve mtimes.
beforeAll(() => {
  utimesSync(resolve(GALLERY, 'blue.png'), new Date(1_000_000), new Date(1_000_000))
  utimesSync(resolve(GALLERY, 'nested/green.png'), new Date(2_000_000), new Date(2_000_000))
})

describe('listImages', () => {
  it('finds images at the top level and in subfolders, as relative posix paths', async () => {
    const { images } = await listImages(GALLERY)
    expect(images.map((i) => i.path).sort()).toEqual(['blue.png', 'nested/green.png'])
  })

  it('presents them in alphabetical order', async () => {
    // blue.png is the older of the two, so this is also the order mtime would
    // *not* have produced.
    const { images } = await listImages(GALLERY)
    expect(images.map((i) => i.path)).toEqual(['blue.png', 'nested/green.png'])
  })

  it('omits non-images — a folder of images is rarely only images', async () => {
    const { images } = await listImages(GALLERY)
    expect(images.some((i) => i.path.endsWith('.txt'))).toBe(false)
  })

  it('omits dot-directories, which hold caches and metadata rather than pictures', async () => {
    const { images } = await listImages(GALLERY)
    expect(images.some((i) => i.path.includes('.hidden'))).toBe(false)
  })

  it('reports size and mtime, so the picker can order and describe entries', async () => {
    const { images } = await listImages(GALLERY)
    const blue = images.find((i) => i.path === 'blue.png')!
    expect(blue.size).toBeGreaterThan(0)
    expect(blue.mtime).toBeGreaterThan(0)
  })

  it('reports a missing folder as empty rather than throwing — a typo in IMAGES_DIR must not take the app down', async () => {
    const { images, truncated } = await listImages(resolve(GALLERY, 'does-not-exist'))
    expect(images).toEqual([])
    expect(truncated).toBe(false)
  })

  it('caps the listing and says when it capped, rather than silently showing a subset', async () => {
    const { images, truncated } = await listImages(GALLERY, { limit: 1 })
    expect(images).toHaveLength(1)
    expect(truncated).toBe(true)
  })

  it('caps by keeping the newest, even though it presents alphabetically', async () => {
    // The two orders are deliberately different jobs. Which images survive a cap
    // should turn on recency — in a folder of renders the newest are the ones
    // being worked on — while what the user reads is a stable A-Z list. Capping
    // alphabetically would keep the oldest, which for `render-001.png` upwards is
    // exactly the wrong half.
    const { images } = await listImages(GALLERY, { limit: 1 })
    expect(images.map((i) => i.path)).toEqual(['nested/green.png'])
  })
})

describe('resolveWithinRoot', () => {
  it('resolves a plain relative path', () => {
    expect(resolveWithinRoot(GALLERY, 'blue.png')).toBe(resolve(GALLERY, 'blue.png'))
  })

  it('resolves into a subfolder', () => {
    expect(resolveWithinRoot(GALLERY, 'nested/green.png')).toBe(
      resolve(GALLERY, 'nested/green.png'),
    )
  })

  // The whole point of the function: the path arrives as a query parameter, so
  // without this the file route is an arbitrary-read primitive on the machine
  // running the dev server.
  it.each([
    '../base.png',
    'nested/../../base.png',
    '..',
    '/etc/passwd',
    'nested/../../../../../../etc/passwd',
  ])('refuses to escape the root via %s', (path) => {
    expect(resolveWithinRoot(GALLERY, path)).toBeNull()
  })

  it('refuses an empty path and the root itself — neither names a file', () => {
    expect(resolveWithinRoot(GALLERY, '')).toBeNull()
    expect(resolveWithinRoot(GALLERY, '.')).toBeNull()
  })

  it('refuses a NUL byte, which can truncate the path inside a syscall', () => {
    expect(resolveWithinRoot(GALLERY, 'blue.png\0.txt')).toBeNull()
  })

  it('refuses a non-image extension even inside the root', () => {
    // The listing never offers it, so a request for one is either a mistake or
    // someone probing. Either way the folder is an image source, not a fileserver.
    expect(resolveWithinRoot(GALLERY, 'notes.txt')).toBeNull()
  })
})

describe('contentTypeFor', () => {
  it.each([
    ['a.png', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.webp', 'image/webp'],
    ['a.gif', 'image/gif'],
    ['a.avif', 'image/avif'],
  ])('maps %s to %s', (name, type) => {
    expect(contentTypeFor(name)).toBe(type)
  })
})
