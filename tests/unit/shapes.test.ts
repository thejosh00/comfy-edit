import { describe, it, expect } from 'vitest'
import {
  beginShape,
  extendShape,
  normalizeRect,
  ellipseFromCorners,
  isDegenerate,
  pixelAt,
  toCanvasPoint,
} from '../../src/core/shapes'
import type { Shape } from '../../src/core/types'

const RED = '#ff0000'

describe('beginShape', () => {
  it('starts a freehand stroke with a single point', () => {
    const s = beginShape('freehand', { x: 10, y: 20 }, RED, 3)
    expect(s).toEqual({ kind: 'freehand', points: [{ x: 10, y: 20 }], color: RED, width: 3 })
  })

  it.each(['line', 'rect', 'ellipse'] as const)(
    'starts a %s degenerate at the click point',
    (tool) => {
      const s = beginShape(tool, { x: 5, y: 7 }, RED, 2)
      expect(s).toEqual({ kind: tool, from: { x: 5, y: 7 }, to: { x: 5, y: 7 }, color: RED, width: 2 })
    },
  )

  it('captures color and width at creation time', () => {
    const a = beginShape('rect', { x: 0, y: 0 }, '#111111', 1)
    const b = beginShape('rect', { x: 0, y: 0 }, '#222222', 9)
    expect(a.color).toBe('#111111')
    expect(a.width).toBe(1)
    expect(b.color).toBe('#222222')
    expect(b.width).toBe(9)
  })
})

describe('extendShape', () => {
  it('appends to a freehand stroke without mutating the original', () => {
    const a = beginShape('freehand', { x: 0, y: 0 }, RED, 1)
    const b = extendShape(a, { x: 5, y: 5 })
    expect(a).toEqual({ kind: 'freehand', points: [{ x: 0, y: 0 }], color: RED, width: 1 })
    expect(b).toMatchObject({ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] })
    expect(b).not.toBe(a)
  })

  it('moves the end point of a two-point shape without mutating the original', () => {
    const a = beginShape('rect', { x: 1, y: 1 }, RED, 1)
    const b = extendShape(a, { x: 9, y: 4 })
    expect(a).toMatchObject({ to: { x: 1, y: 1 } })
    expect(b).toMatchObject({ from: { x: 1, y: 1 }, to: { x: 9, y: 4 } })
  })

  it('constrains a line to the nearest 45 degrees when asked', () => {
    const a = beginShape('line', { x: 0, y: 0 }, RED, 1)
    // 30 degrees off horizontal snaps down to horizontal.
    const b = extendShape(a, { x: 100, y: 20 }, { constrain: true })
    expect(b).toMatchObject({ to: { x: 100, y: 0 } })

    // 50 degrees snaps up to the diagonal.
    const c = extendShape(a, { x: 100, y: 90 }, { constrain: true })
    expect(c).toMatchObject({ to: { x: 100, y: 100 } })
  })

  it('constrains a rect to a square, preserving drag direction', () => {
    const a = beginShape('rect', { x: 10, y: 10 }, RED, 1)
    const b = extendShape(a, { x: 60, y: 30 }, { constrain: true })
    const { from, to } = b as Extract<Shape, { kind: 'rect' }>
    expect(Math.abs(to.x - from.x)).toBe(Math.abs(to.y - from.y))

    const c = extendShape(a, { x: -40, y: -10 }, { constrain: true })
    const cc = c as Extract<Shape, { kind: 'rect' }>
    expect(cc.to.x).toBeLessThan(cc.from.x)
    expect(cc.to.y).toBeLessThan(cc.from.y)
    expect(Math.abs(cc.to.x - cc.from.x)).toBe(Math.abs(cc.to.y - cc.from.y))
  })

  it('constrains an ellipse to a circle', () => {
    const a = beginShape('ellipse', { x: 0, y: 0 }, RED, 1)
    const b = extendShape(a, { x: 80, y: 20 }, { constrain: true })
    const { cx, cy, rx, ry } = ellipseFromCorners(
      (b as Extract<Shape, { kind: 'ellipse' }>).from,
      (b as Extract<Shape, { kind: 'ellipse' }>).to,
    )
    expect(rx).toBe(ry)
    expect(cx).toBeGreaterThan(0)
    expect(cy).toBeGreaterThan(0)
  })
})

describe('normalizeRect', () => {
  it.each([
    ['top-left to bottom-right', { x: 10, y: 10 }, { x: 30, y: 50 }],
    ['bottom-right to top-left', { x: 30, y: 50 }, { x: 10, y: 10 }],
    ['top-right to bottom-left', { x: 30, y: 10 }, { x: 10, y: 50 }],
    ['bottom-left to top-right', { x: 10, y: 50 }, { x: 30, y: 10 }],
  ])('normalizes a drag %s', (_label, from, to) => {
    expect(normalizeRect(from, to)).toEqual({ x: 10, y: 10, w: 20, h: 40 })
  })
})

describe('ellipseFromCorners', () => {
  it('centres between the corners with half-extent radii', () => {
    expect(ellipseFromCorners({ x: 0, y: 0 }, { x: 40, y: 20 })).toEqual({
      cx: 20,
      cy: 10,
      rx: 20,
      ry: 10,
    })
  })

  it('is independent of drag direction', () => {
    const a = ellipseFromCorners({ x: 0, y: 0 }, { x: 40, y: 20 })
    const b = ellipseFromCorners({ x: 40, y: 20 }, { x: 0, y: 0 })
    expect(a).toEqual(b)
  })
})

describe('isDegenerate', () => {
  it('is true for a click with no drag on every two-point tool', () => {
    for (const tool of ['line', 'rect', 'ellipse'] as const) {
      expect(isDegenerate(beginShape(tool, { x: 3, y: 4 }, RED, 1))).toBe(true)
    }
  })

  it('is true for a freehand stroke with fewer than two points', () => {
    expect(isDegenerate(beginShape('freehand', { x: 3, y: 4 }, RED, 1))).toBe(true)
  })

  it('is false once the shape has extent', () => {
    const rect = extendShape(beginShape('rect', { x: 0, y: 0 }, RED, 1), { x: 10, y: 10 })
    const stroke = extendShape(beginShape('freehand', { x: 0, y: 0 }, RED, 1), { x: 1, y: 1 })
    expect(isDegenerate(rect)).toBe(false)
    expect(isDegenerate(stroke)).toBe(false)
  })
})

describe('toCanvasPoint', () => {
  it('maps client coordinates straight through at 1:1 scale', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 }
    expect(toCanvasPoint(rect, { w: 100, h: 100 }, 25, 75)).toEqual({ x: 25, y: 75 })
  })

  it('scales when the canvas is presented smaller than its backing store', () => {
    // A 1000x500 image shown at 250x125 on screen: a click at the visual centre
    // must land at the centre of the backing store, not at the screen coordinate.
    const rect = { left: 0, top: 0, width: 250, height: 125 }
    expect(toCanvasPoint(rect, { w: 1000, h: 500 }, 125, 62.5)).toEqual({ x: 500, y: 250 })
  })

  it('accounts for the element offset within the page', () => {
    const rect = { left: 40, top: 20, width: 200, height: 200 }
    expect(toCanvasPoint(rect, { w: 400, h: 400 }, 140, 120)).toEqual({ x: 200, y: 200 })
  })
})

describe('pixelAt', () => {
  it('floors to the pixel the pointer is over', () => {
    expect(pixelAt({ x: 10.9, y: 4.2 }, { w: 100, h: 100 })).toEqual({ x: 10, y: 4 })
  })

  it('clamps to the last pixel, not past it', () => {
    // toCanvasPoint does not clamp, and a pointer released a fraction beyond the
    // edge would otherwise ask getImageData for a pixel outside the canvas.
    expect(pixelAt({ x: 100, y: 100 }, { w: 100, h: 100 })).toEqual({ x: 99, y: 99 })
    expect(pixelAt({ x: 1e6, y: 1e6 }, { w: 64, h: 32 })).toEqual({ x: 63, y: 31 })
  })

  it('clamps negatives to the origin', () => {
    expect(pixelAt({ x: -3, y: -0.5 }, { w: 100, h: 100 })).toEqual({ x: 0, y: 0 })
  })
})
