export type Point = { x: number; y: number }

export type Size = { w: number; h: number }

export type ToolId = 'freehand' | 'line' | 'rect' | 'ellipse'

/**
 * One drawn mark. Color and width are captured at creation time, so changing the
 * toolbar afterwards never restyles existing marks.
 * All coordinates are canvas pixel space, never screen space.
 */
export type Shape =
  | { kind: 'freehand'; points: Point[]; color: string; width: number }
  | { kind: 'line'; from: Point; to: Point; color: string; width: number }
  | { kind: 'rect'; from: Point; to: Point; color: string; width: number }
  | { kind: 'ellipse'; from: Point; to: Point; color: string; width: number }

export type Rect = { x: number; y: number; w: number; h: number }

export type Ellipse = { cx: number; cy: number; rx: number; ry: number }
