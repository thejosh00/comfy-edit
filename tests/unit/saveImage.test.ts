import { describe, it, expect } from 'vitest'
import { defaultSaveName, prepareSaveName, saveUrl } from '../../src/core/saveImage'

describe('prepareSaveName', () => {
  it('accepts a plain png name', () => {
    expect(prepareSaveName('sunset.png')).toEqual({ ok: true, name: 'sunset.png' })
  })

  it('adds the extension when there is none, which is what most people type', () => {
    expect(prepareSaveName('sunset')).toEqual({ ok: true, name: 'sunset.png' })
  })

  it('trims surrounding space rather than creating a file with a leading blank', () => {
    expect(prepareSaveName('  sunset.png  ')).toEqual({ ok: true, name: 'sunset.png' })
  })

  it('accepts .PNG, since the extension is only ever compared case-insensitively', () => {
    expect(prepareSaveName('SUNSET.PNG')).toEqual({ ok: true, name: 'SUNSET.PNG' })
  })

  it('rejects an empty name', () => {
    expect(prepareSaveName('')).toMatchObject({ ok: false })
    expect(prepareSaveName('   ')).toMatchObject({ ok: false })
  })

  it('rejects another image extension, because the bytes written are always PNG', () => {
    // Writing PNG bytes into a file called .jpg produces a file that most tools
    // open anyway and one or two refuse — a slow, confusing failure. Better to
    // say so now.
    const result = prepareSaveName('sunset.jpg')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/png/i)
  })

  it.each(['a/b.png', 'a\\b.png', '/tmp/a.png', '../a.png', '..', '.'])(
    'rejects %s — the dialog asks for a filename, not a path',
    (raw) => {
      expect(prepareSaveName(raw)).toMatchObject({ ok: false })
    },
  )

  it('rejects a NUL byte, which can truncate the name inside a syscall', () => {
    expect(prepareSaveName('a\0.png')).toMatchObject({ ok: false })
  })

  it('rejects a name that is only an extension', () => {
    expect(prepareSaveName('.png')).toMatchObject({ ok: false })
  })
})

describe('defaultSaveName', () => {
  it('names a generated image after the workflow and seed that made it', () => {
    // Two saves from one session then differ by default, which is what stops the
    // "that name is taken" path from being the common case.
    expect(
      defaultSaveName({
        kind: 'generation',
        workflowId: 'qwen-2511',
        prompt: 'make it dusk',
        seed: 42,
        promptId: 'p1',
        loras: [],
      }),
    ).toBe('qwen-2511-42.png')
  })

  it('falls back to something plain for an opened image', () => {
    expect(defaultSaveName({ kind: 'upload' })).toBe('image.png')
  })
})

describe('saveUrl', () => {
  it('carries the folder and the name as parameters', () => {
    const url = new URL(saveUrl('/srv/out', 'a b.png'), 'http://x')
    expect(url.pathname).toBe('/local/save')
    expect(url.searchParams.get('dir')).toBe('/srv/out')
    expect(url.searchParams.get('name')).toBe('a b.png')
  })
})
