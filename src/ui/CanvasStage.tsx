import { useCallback, useEffect, useRef, useState } from 'react'
import { renderScene, type Ctx2D } from '../core/render'
import { beginShape, extendShape, isDegenerate, pixelAt, toCanvasPoint } from '../core/shapes'
import { sampledColor } from '../core/color'
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
  onPickColor: (hex: string) => void
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export function CanvasStage({
  base,
  shapes,
  tool,
  color,
  width,
  onCommit,
  onPickColor,
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

  /**
   * Sample the composited canvas — base image plus every mark already drawn — so
   * the eyedropper picks up what the user can actually see. Reading pixels is only
   * possible because everything reaches the canvas same-origin; a tainted canvas
   * makes getImageData throw.
   */
  const sample = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const at = pixelAt(pointFrom(e), { w: canvas.width, h: canvas.height })
    const picked = sampledColor(ctx.getImageData(at.x, at.y, 1, 1).data)
    if (picked) onPickColor(picked)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!base) return
    if (tool === 'eyedropper') {
      // No pointer capture and no draft: sampling is a click, not a drag, and it
      // must never reach the undo stack.
      sample(e)
      return
    }
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
        data-tool={tool}
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
