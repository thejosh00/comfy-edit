import { useCallback, useEffect, useRef, useState } from 'react'
import { renderScene, type Ctx2D } from '../core/render'
import { beginShape, extendShape, isDegenerate, toCanvasPoint } from '../core/shapes'
import type { Shape, ToolId } from '../core/types'
import { T } from '../testids'
import type { BaseImage } from './useEditor'

type Props = {
  base: BaseImage | null
  shapes: readonly Shape[]
  tool: ToolId
  color: string
  width: number
  onCommit: (shape: Shape) => void
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export function CanvasStage({
  base,
  shapes,
  tool,
  color,
  width,
  onCommit,
  canvasRef,
}: Props) {
  // The in-flight shape lives in a ref as well as state. State drives rendering;
  // the ref is what pointerup reads, so committing is never a side effect inside a
  // setState updater — StrictMode double-invokes those, which committed every
  // shape twice.
  const [draft, setDraft] = useState<Shape | null>(null)
  const draftRef = useRef<Shape | null>(null)
  const drawing = useRef(false)

  const setDraftShape = (shape: Shape | null) => {
    draftRef.current = shape
    setDraft(shape)
  }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d') as unknown as Ctx2D | null
    if (!ctx) return

    const all = draft ? [...shapes, draft] : shapes
    renderScene(ctx, base?.bitmap ?? null, all, {
      w: base?.width ?? canvas.width,
      h: base?.height ?? canvas.height,
    })
  }, [base, shapes, draft, canvasRef])

  useEffect(redraw, [redraw])

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    return toCanvasPoint(
      canvas.getBoundingClientRect(),
      { w: canvas.width, h: canvas.height },
      e.clientX,
      e.clientY,
    )
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!base) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    setDraftShape(beginShape(tool, pointFrom(e), color, width))
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !draftRef.current) return
    // Read the event synchronously: React nulls currentTarget once the handler returns.
    const at = pointFrom(e)
    setDraftShape(extendShape(draftRef.current, at, { constrain: e.shiftKey }))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    drawing.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)

    const finished = draftRef.current
    setDraftShape(null)
    // A click with no drag adds nothing.
    if (finished && !isDegenerate(finished)) onCommit(finished)
  }

  if (!base) {
    return (
      <div className="stage">
        <div className="drop-zone" data-testid={T.imageDropZone}>
          Choose an image or paste one to start
        </div>
      </div>
    )
  }

  return (
    <div className="stage">
      <canvas
        data-testid={T.editorCanvas}
        ref={canvasRef}
        width={base.width}
        height={base.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}
