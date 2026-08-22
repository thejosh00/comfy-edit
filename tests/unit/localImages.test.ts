import { describe, it, expect } from 'vitest'
import {
  alphabetical,
  basename,
  dirsUrl,
  displayName,
  imagesUrl,
  isImageFilename,
  localFileUrl,
  newestFirst,
  parseDirListing,
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
    const url = new URL(localFileUrl('/srv/images', 'blue.png'), 'http://x')
    expect(url.pathname).toBe('/local/file')
    expect(url.searchParams.get('dir')).toBe('/srv/images')
    expect(url.searchParams.get('path')).toBe('blue.png')
  })

  it('encodes separators and spaces rather than letting them reshape the URL', () => {
    const url = localFileUrl('/srv/my images', 'holiday snaps/a&b.png')
    expect(url).toContain('%26')
    const parsed = new URL(url, 'http://x')
    expect(parsed.searchParams.get('dir')).toBe('/srv/my images')
    expect(parsed.searchParams.get('path')).toBe('holiday snaps/a&b.png')
  })
})

describe('imagesUrl', () => {
  it('names the directory to list', () => {
    const url = new URL(imagesUrl('/srv/my images'), 'http://x')
    expect(url.pathname).toBe('/local/images')
    expect(url.searchParams.get('dir')).toBe('/srv/my images')
  })
})

describe('dirsUrl', () => {
  it('names the directory to browse', () => {
    const url = new URL(dirsUrl('/srv/images'), 'http://x')
    expect(url.pathname).toBe('/local/dirs')
    expect(url.searchParams.get('path')).toBe('/srv/images')
  })

  it('omits the path entirely when there is none, which is what asks for the default', () => {
    // The server answers a pathless request with the home directory. Sending an
    // empty string instead would be a request to browse "", which is not a place.
    expect(dirsUrl()).toBe('/local/dirs')
    expect(dirsUrl(null)).toBe('/local/dirs')
  })
})

describe('parseDirListing', () => {
  it('reads a directory listing', () => {
    const listing = parseDirListing({
      path: '/srv/images',
      parent: '/srv',
      dirs: ['nested', 'renders'],
    })
    expect(listing).toEqual({ path: '/srv/images', parent: '/srv', dirs: ['nested', 'renders'] })
  })

  it('accepts a null parent, which is how the filesystem root says it has none', () => {
    expect(parseDirListing({ path: '/', parent: null, dirs: [] }).parent).toBeNull()
  })

  it.each([null, 'nope', {}, { path: '/x', dirs: 'nope' }, { path: 7, dirs: [] }])(
    'rejects a response that is not a directory listing: %s',
    (json) => {
      expect(() => parseDirListing(json)).toThrow(LocalFolderError)
    },
  )

  it('rejects a non-string directory name', () => {
    expect(() => parseDirListing({ path: '/x', parent: null, dirs: [7] })).toThrow(LocalFolderError)
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
  it('reads a folder listing', () => {
    const folder = parseLocalFolder({
      root: '/srv/images',
      truncated: false,
      images: [{ path: 'blue.png', size: 663, mtime: 12 }],
    })
    expect(folder.root).toBe('/srv/images')
    expect(folder.images).toEqual([{ path: 'blue.png', size: 663, mtime: 12 }])
  })

  it('reads an empty folder', () => {
    expect(parseLocalFolder({ root: '/srv/empty', truncated: false, images: [] }).images).toEqual([])
  })

  it('carries the truncation flag, so a capped listing can say so', () => {
    expect(parseLocalFolder({ root: '/x', truncated: true, images: [] }).truncated).toBe(true)
  })

  it.each([null, 'nope', {}, { root: '/x', images: 'nope' }])(
    'rejects a response that is not a folder listing: %s',
    (json) => {
      expect(() => parseLocalFolder(json)).toThrow(LocalFolderError)
    },
  )

  it('rejects an entry missing a path — a thumbnail with no URL is not renderable', () => {
    expect(() => parseLocalFolder({ root: '/x', images: [{ size: 1, mtime: 1 }] })).toThrow(
      LocalFolderError,
    )
  })
})
