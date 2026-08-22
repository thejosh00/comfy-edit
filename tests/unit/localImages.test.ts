import { describe, it, expect } from 'vitest'
import {
  alphabetical,
  basename,
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

describe('alphabetical', () => {
  it('orders by path', () => {
    const sorted = alphabetical([IMAGE('c.png', 1), IMAGE('a.png', 2), IMAGE('b.png', 3)])
    expect(sorted.map((i) => i.path)).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('ignores mtime — that is the whole difference from newestFirst', () => {
    const sorted = alphabetical([IMAGE('a.png', 999), IMAGE('b.png', 1)])
    expect(sorted.map((i) => i.path)).toEqual(['a.png', 'b.png'])
  })

  it('orders numbers by value, so render-2 comes before render-10', () => {
    // Unpadded counters are the norm for hand-named files, and a plain string
    // sort scatters them: render-10 would land between render-1 and render-2.
    const sorted = alphabetical([
      IMAGE('render-10.png', 1),
      IMAGE('render-2.png', 1),
      IMAGE('render-1.png', 1),
    ])
    expect(sorted.map((i) => i.path)).toEqual(['render-1.png', 'render-2.png', 'render-10.png'])
  })

  it('ignores case, as a file manager does', () => {
    const sorted = alphabetical([IMAGE('beta.png', 1), IMAGE('Alpha.png', 1), IMAGE('gamma.png', 1)])
    expect(sorted.map((i) => i.path)).toEqual(['Alpha.png', 'beta.png', 'gamma.png'])
  })

  it('keeps a subfolder together rather than interleaving it', () => {
    const sorted = alphabetical([
      IMAGE('sketches/b.png', 1),
      IMAGE('renders/z.png', 1),
      IMAGE('sketches/a.png', 1),
      IMAGE('renders/y.png', 1),
    ])
    expect(sorted.map((i) => i.path)).toEqual([
      'renders/y.png',
      'renders/z.png',
      'sketches/a.png',
      'sketches/b.png',
    ])
  })

  it('is deterministic for names that differ only by case', () => {
    // Case-insensitive comparison calls these equal, so without a final
    // tie-break their order would be whatever the sort happened to do.
    expect(alphabetical([IMAGE('a.png', 1), IMAGE('A.png', 1)]).map((i) => i.path)).toEqual(
      alphabetical([IMAGE('A.png', 1), IMAGE('a.png', 1)]).map((i) => i.path),
    )
  })

  it('does not mutate its argument', () => {
    const input = [IMAGE('b.png', 1), IMAGE('a.png', 2)]
    alphabetical(input)
    expect(input.map((i) => i.path)).toEqual(['b.png', 'a.png'])
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

describe('basename', () => {
  // The tile caption. At thumbnail width there is only room for a handful of
  // characters, and the leading folder is the part they can least afford: every
  // file in one subfolder would caption identically.
  it('drops the folder', () => {
    expect(basename('nested/green.png')).toBe('green.png')
    expect(basename('a/b/c/deep.png')).toBe('deep.png')
  })

  it('leaves a top-level name alone', () => {
    expect(basename('blue.png')).toBe('blue.png')
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
