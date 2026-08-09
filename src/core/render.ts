import { ellipseFromCorners, normalizeRect } from './shapes'
import type { Shape, Size } from './types'

/**
 * The subset of CanvasRenderingContext2D this renderer uses. Declared structurally
 * so the real context satisfies it with no cast, and so unit tests can pass a
 * recording fake instead of pulling in jsdom or node-canvas.
 */
export interface Ctx2D {
  strokeStyle: string
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  save(): void
  restore(): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  strokeRect(x: number, y: number, w: number, h: number): void
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void
  clearRect(x: number, y: number, w: number, h: number): void
  drawImage(image: never, x: number, y: number): void
}

export function drawShape(ctx: Ctx2D, shape: Shape): void {
  ctx.save()
  ctx.strokeStyle = shape.color
  ctx.lineWidth = shape.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (shape.kind) {
    case 'freehand': {
      const [first, ...rest] = shape.points
      if (first) {
        ctx.beginPath()
        ctx.moveTo(first.x, first.y)
        for (const p of rest) ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
      break
    }
    case 'line': {
      ctx.beginPath()
      ctx.moveTo(shape.from.x, shape.from.y)
      ctx.lineTo(shape.to.x, shape.to.y)
      ctx.stroke()
      break
    }
    case 'rect': {
      const { x, y, w, h } = normalizeRect(shape.from, shape.to)
      ctx.strokeRect(x, y, w, h)
      break
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = ellipseFromCorners(shape.from, shape.to)
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
  }

  ctx.restore()
}

/**
 * Full redraw: clear, base image, then every mark in draw order. At 1024² with a
 * few thousand points this is well under a millisecond, so the simplicity is free.
 */
export function renderScene(
  ctx: Ctx2D,
  base: unknown | null,
  shapes: readonly Shape[],
  size: Size,
): void {
  ctx.clearRect(0, 0, size.w, size.h)
  if (base) ctx.drawImage(base as never, 0, 0)
  for (const shape of shapes) drawShape(ctx, shape)
}
