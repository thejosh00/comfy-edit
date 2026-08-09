import { describe, it, expect } from 'vitest'
import { renderScene, type Ctx2D } from '../../src/core/render'
import type { Shape } from '../../src/core/types'

/**
 * SC-002: drawing stays responsive up to 2048x2048 with a full redraw per pointer
 * move. This measures the scene-building cost — the part the retained-mode
 * decision (research.md D2) rests on — against a no-op context, so it isolates our
 * work from the GPU's.
 *
 * If this ever fails, the escape hatch is the two-layer canvas noted in research.md:
 * committed strokes on a static canvas, the in-flight shape on an overlay.
 */

/** A context that does nothing, so the measurement is our traversal, not rasterization. */
function nullCtx(): Ctx2D {
  const noop = () => {}
  return {
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    strokeRect: noop,
    ellipse: noop,
    clearRect: noop,
    drawImage: noop,
  } as Ctx2D
}

function makeShapes(count: number, pointsEach: number): Shape[] {
  return Array.from({ length: count }, (_, i): Shape => {
    if (i % 4 === 0) {
      return {
        kind: 'freehand',
        points: Array.from({ length: pointsEach }, (_, p) => ({ x: (i + p) % 2048, y: (i * 7 + p) % 2048 })),
        color: '#ff0000',
        width: 3,
      }
    }
    const kinds = ['line', 'rect', 'ellipse'] as const
    return {
      kind: kinds[i % 3]!,
      from: { x: i % 2048, y: (i * 3) % 2048 },
      to: { x: (i * 5) % 2048, y: (i * 11) % 2048 },
      color: '#00ff00',
      width: 2,
    }
  })
}

describe('render performance (SC-002)', () => {
  it('builds a 2000-shape scene at 2048x2048 well inside a 16ms frame', () => {
    const ctx = nullCtx()
    const shapes = makeShapes(2000, 40)
    const size = { w: 2048, h: 2048 }

    // Warm up, then take the best of several passes to reduce scheduler noise.
    for (let i = 0; i < 3; i++) renderScene(ctx, {}, shapes, size)

    let best = Infinity
    for (let i = 0; i < 10; i++) {
      const started = performance.now()
      renderScene(ctx, {}, shapes, size)
      best = Math.min(best, performance.now() - started)
    }

    // 16ms is one frame at 60fps. A generous ceiling: this should be well under.
    expect(best).toBeLessThan(16)
  })

  it('stays linear in shape count rather than blowing up', () => {
    const ctx = nullCtx()
    const size = { w: 2048, h: 2048 }
    const small = makeShapes(500, 40)
    const large = makeShapes(4000, 40)

    const time = (shapes: Shape[]) => {
      for (let i = 0; i < 3; i++) renderScene(ctx, {}, shapes, size)
      let best = Infinity
      for (let i = 0; i < 10; i++) {
        const started = performance.now()
        renderScene(ctx, {}, shapes, size)
        best = Math.min(best, performance.now() - started)
      }
      return best
    }

    // 8x the shapes should cost roughly 8x, not 8^2. Loose bound to stay non-flaky.
    expect(time(large)).toBeLessThan(time(small) * 40 + 5)
  })
})
