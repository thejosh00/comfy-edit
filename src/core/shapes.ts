import type { Ellipse, Point, Rect, Shape, Size, ToolId } from './types'

export type DOMRectLike = { left: number; top: number; width: number; height: number }

export type ExtendOpts = { constrain?: boolean }

export function beginShape(tool: ToolId, at: Point, color: string, width: number): Shape {
  if (tool === 'freehand') return { kind: 'freehand', points: [at], color, width }
  return { kind: tool, from: at, to: at, color, width }
}

export function extendShape(shape: Shape, at: Point, opts: ExtendOpts = {}): Shape {
  if (shape.kind === 'freehand') {
    return { ...shape, points: [...shape.points, at] }
  }

  const to = opts.constrain ? constrain(shape.kind, shape.from, at) : at
  return { ...shape, to }
}

/** Snap lines to 45° increments; force rects and ellipses square, preserving drag direction. */
function constrain(kind: 'line' | 'rect' | 'ellipse', from: Point, at: Point): Point {
  const dx = at.x - from.x
  const dy = at.y - from.y
  const square = () => {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    return {
      x: from.x + Math.sign(dx || 1) * size,
      y: from.y + Math.sign(dy || 1) * size,
    }
  }

  if (kind !== 'line') return square()

  // Snap to the nearest of the 8 octants, then follow the cursor along that axis
  // rather than preserving the drag length — the convention drawing tools use.
  const octant = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8
  if (octant === 0 || octant === 4) return { x: at.x, y: from.y }
  if (octant === 2 || octant === 6) return { x: from.x, y: at.y }
  return square()
}

export function normalizeRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  }
}

export function ellipseFromCorners(from: Point, to: Point): Ellipse {
  const { x, y, w, h } = normalizeRect(from, to)
  return { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }
}

/** A click with no drag. Never committed, so a stray click cannot fill the undo stack. */
export function isDegenerate(shape: Shape): boolean {
  if (shape.kind === 'freehand') return shape.points.length < 2
  return shape.from.x === shape.to.x && shape.from.y === shape.to.y
}

/**
 * Convert a pointer event's client coordinates into canvas pixel space.
 * The canvas backing store is the image's natural size while CSS scales its
 * presentation, so this factor is what makes marks land where the user aims.
 */
export function toCanvasPoint(
  rect: DOMRectLike,
  canvas: Size,
  clientX: number,
  clientY: number,
): Point {
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.w,
    y: ((clientY - rect.top) / rect.height) * canvas.h,
  }
}
