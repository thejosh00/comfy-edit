import { describe, it, expect } from 'vitest'
import { drawShape, renderScene, type Ctx2D } from '../../src/core/render'
import type { Shape } from '../../src/core/types'

type Call = { op: string; args: unknown[] }

/**
 * A recording 2D context. Fifteen lines is all it takes to get the renderer under
 * test with no jsdom and no node-canvas — the point of declaring Ctx2D structurally.
 */
function recorder() {
  const calls: Call[] = []
  const sets: Record<string, unknown[]> = {}
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args })
    }

  const ctx = {
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    strokeRect: record('strokeRect'),
    ellipse: record('ellipse'),
    clearRect: record('clearRect'),
    drawImage: record('drawImage'),
  } as unknown as Ctx2D

  // Track assignments so we can assert style came from the shape, not ambient state.
  return {
    ctx: new Proxy(ctx as object, {
      set(target, prop, value) {
        ;(sets[String(prop)] ??= []).push(value)
        return Reflect.set(target, prop, value)
      },
    }) as Ctx2D,
    calls,
    sets,
    ops: () => calls.map((c) => c.op),
  }
}

const line: Shape = {
  kind: 'line',
  from: { x: 0, y: 0 },
  to: { x: 10, y: 10 },
  color: '#123456',
  width: 4,
}

describe('drawShape', () => {
  it('strokes a freehand path through every point', () => {
    const r = recorder()
    drawShape(r.ctx, {
      kind: 'freehand',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 9, y: 1 },
      ],
      color: '#abcdef',
      width: 2,
    })

    expect(r.ops()).toEqual(['save', 'beginPath', 'moveTo', 'lineTo', 'lineTo', 'stroke', 'restore'])
    expect(r.calls[2]!.args).toEqual([0, 0])
    expect(r.calls[3]!.args).toEqual([5, 5])
    expect(r.calls[4]!.args).toEqual([9, 1])
  })

  it('strokes a straight line between the two points', () => {
    const r = recorder()
    drawShape(r.ctx, line)
    expect(r.ops()).toEqual(['save', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'restore'])
    expect(r.calls[2]!.args).toEqual([0, 0])
    expect(r.calls[3]!.args).toEqual([10, 10])
  })

  it('strokes a rectangle normalized to its top-left corner', () => {
    const r = recorder()
    drawShape(r.ctx, {
      kind: 'rect',
      from: { x: 30, y: 50 },
      to: { x: 10, y: 10 },
      color: '#fff',
      width: 1,
    })
    expect(r.ops()).toEqual(['save', 'strokeRect', 'restore'])
    expect(r.calls[1]!.args).toEqual([10, 10, 20, 40])
  })

  it('strokes an ellipse from its centre with half-extent radii', () => {
    const r = recorder()
    drawShape(r.ctx, {
      kind: 'ellipse',
      from: { x: 0, y: 0 },
      to: { x: 40, y: 20 },
      color: '#fff',
      width: 1,
    })
    expect(r.ops()).toEqual(['save', 'beginPath', 'ellipse', 'stroke', 'restore'])
    expect(r.calls[2]!.args.slice(0, 4)).toEqual([20, 10, 20, 10])
  })

  it('takes stroke style and width from the shape, not from ambient state', () => {
    const r = recorder()
    r.ctx.strokeStyle = '#000000'
    r.ctx.lineWidth = 99

    drawShape(r.ctx, line)

    expect(r.sets['strokeStyle']).toContain('#123456')
    expect(r.sets['lineWidth']).toContain(4)
  })

  it('brackets every shape in save/restore so styles never leak', () => {
    const r = recorder()
    drawShape(r.ctx, line)
    const ops = r.ops()
    expect(ops[0]).toBe('save')
    expect(ops[ops.length - 1]).toBe('restore')
  })
})

describe('renderScene', () => {
  it('clears, draws the base image, then draws shapes in order', () => {
    const r = recorder()
    const base = { fake: 'image' }
    renderScene(r.ctx, base, [line, line], { w: 100, h: 80 })

    const ops = r.ops()
    expect(ops[0]).toBe('clearRect')
    expect(r.calls[0]!.args).toEqual([0, 0, 100, 80])
    expect(ops[1]).toBe('drawImage')
    expect(ops.filter((o) => o === 'stroke')).toHaveLength(2)
  })

  it('clears and draws nothing else when there is no base image', () => {
    const r = recorder()
    renderScene(r.ctx, null, [], { w: 10, h: 10 })
    expect(r.ops()).toEqual(['clearRect'])
  })
})
