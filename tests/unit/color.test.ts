import { describe, it, expect } from 'vitest'
import { rgbToHex, sampledColor } from '../../src/core/color'

describe('rgbToHex', () => {
  it('formats a colour the way an <input type="color"> expects it', () => {
    // Lowercase, six digits, leading hash — anything else and the input silently
    // ignores the value and stays on its previous colour.
    expect(rgbToHex(0, 128, 128)).toBe('#008080')
    expect(rgbToHex(255, 0, 255)).toBe('#ff00ff')
  })

  it('pads single digits', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203')
  })

  it('handles the extremes', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff')
  })

  it('rounds and clamps, so a stray float or out-of-range value still formats', () => {
    expect(rgbToHex(127.6, -5, 300)).toBe('#8000ff')
  })
})

describe('sampledColor', () => {
  it('reads an opaque pixel', () => {
    expect(sampledColor([0, 128, 128, 255])).toBe('#008080')
  })

  it('ignores alpha short of transparent — a nearly-clear pixel still has a colour', () => {
    expect(sampledColor([255, 0, 255, 1])).toBe('#ff00ff')
  })

  it('returns null for a fully transparent pixel', () => {
    // Clicking a hole in an image with an alpha channel should leave the current
    // colour alone rather than silently setting black.
    expect(sampledColor([0, 0, 0, 0])).toBeNull()
  })

  it('returns null for a sample that is not four channels', () => {
    expect(sampledColor([0, 128])).toBeNull()
  })
})
