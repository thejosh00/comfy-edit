import { describe, it, expect } from 'vitest'
import {
  displayName,
  isImageFilename,
  localFileUrl,
  newestFirst,
  parseLocalFolder,
  LocalFolderError,
  type LocalImage,
} from '../../src/core/localImages'

const IMAGE = (path: string, mtime: number): LocalImage => ({ path, size: 1, mtime })

describe('isImageFilename', () => {
  it.each(['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif', 'a.bmp', 'a.avif'])(
    'accepts %s',
    (name) => {
      expect(isImageFilename(name)).toBe(true)
    },
  )

  it('is case-insensitive — cameras and Windows both produce .JPG', () => {
    expect(isImageFilename('DSC_0001.JPG')).toBe(true)
    expect(isImageFilename('a.PNG')).toBe(true)
  })

  it.each(['notes.txt', 'workflow.json', 'model.safetensors', 'noextension', 'a.png.txt'])(
    'rejects %s',
    (name) => {
      expect(isImageFilename(name)).toBe(false)
    },
  )

  it('rejects a bare dotfile that only looks like an extension', () => {
    expect(isImageFilename('.png')).toBe(false)
  })
})

describe('newestFirst', () => {
  it('orders by mtime, newest first', () => {
    const sorted = newestFirst([IMAGE('old.png', 100), IMAGE('new.png', 300), IMAGE('mid.png', 200)])
    expect(sorted.map((i) => i.path)).toEqual(['new.png', 'mid.png', 'old.png'])
  })

  it('breaks mtime ties by path, so a listing is stable across calls', () => {
    // Files written in one batch — a checkout, an unzip — share an mtime to the
    // millisecond. Without a tie-break the order is whatever readdir happened to
    // return, which differs between filesystems and breaks any test that indexes.
    const sorted = newestFirst([IMAGE('b.png', 100), IMAGE('a.png', 100), IMAGE('c.png', 100)])
    expect(sorted.map((i) => i.path)).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('does not mutate its argument', () => {
    const input = [IMAGE('old.png', 100), IMAGE('new.png', 300)]
    newestFirst(input)
    expect(input.map((i) => i.path)).toEqual(['old.png', 'new.png'])
  })
})

describe('localFileUrl', () => {
  it('points at the same-origin middleware, so the canvas is never tainted', () => {
    expect(localFileUrl('blue.png')).toBe('/local/file?path=blue.png')
  })

  it('encodes separators and spaces rather than letting them reshape the URL', () => {
    const url = localFileUrl('holiday snaps/a&b.png')
    expect(url).toBe('/local/file?path=holiday+snaps%2Fa%26b.png')
    expect(new URL(url, 'http://x').searchParams.get('path')).toBe('holiday snaps/a&b.png')
  })
})

describe('displayName', () => {
  it('is the bare filename for a top-level file', () => {
    expect(displayName('blue.png')).toBe('blue.png')
  })

  it('keeps the subfolder, which is often the only thing telling two files apart', () => {
    expect(displayName('nested/green.png')).toBe('nested/green.png')
  })
})

describe('parseLocalFolder', () => {
  it('reads a configured folder', () => {
    const folder = parseLocalFolder({
      enabled: true,
      root: '/srv/images',
      truncated: false,
      images: [{ path: 'blue.png', size: 663, mtime: 12 }],
    })
    expect(folder.enabled).toBe(true)
    expect(folder.root).toBe('/srv/images')
    expect(folder.images).toEqual([{ path: 'blue.png', size: 663, mtime: 12 }])
  })

  it('reads the disabled response served when no folder is configured', () => {
    const folder = parseLocalFolder({ enabled: false, root: null, truncated: false, images: [] })
    expect(folder.enabled).toBe(false)
    expect(folder.images).toEqual([])
  })

  it('carries the truncation flag, so a capped listing can say so', () => {
    expect(parseLocalFolder({ enabled: true, root: '/x', truncated: true, images: [] }).truncated)
      .toBe(true)
  })

  it.each([null, 'nope', {}, { enabled: true, images: 'nope' }])(
    'rejects a response that is not a folder listing: %s',
    (json) => {
      expect(() => parseLocalFolder(json)).toThrow(LocalFolderError)
    },
  )

  it('rejects an entry missing a path — a thumbnail with no URL is not renderable', () => {
    expect(() => parseLocalFolder({ enabled: true, root: '/x', images: [{ size: 1, mtime: 1 }] }))
      .toThrow(LocalFolderError)
  })
})
