import type { ToolId } from '../core/types'
import { T } from '../testids'

const TOOLS: Array<{ id: ToolId; testId: string; label: string }> = [
  { id: 'freehand', testId: T.toolFreehand, label: 'Draw' },
  { id: 'line', testId: T.toolLine, label: 'Line' },
  { id: 'rect', testId: T.toolRect, label: 'Rect' },
  { id: 'ellipse', testId: T.toolEllipse, label: 'Ellipse' },
  { id: 'eyedropper', testId: T.toolEyedropper, label: 'Pick' },
]

type Props = {
  tool: ToolId
  color: string
  width: number
  canUndo: boolean
  canRedo: boolean
  hasShapes: boolean
  onTool: (t: ToolId) => void
  onColor: (c: string) => void
  onWidth: (w: number) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onPickFile: () => void
  onPickFolder: () => void
  onSave: () => void
  canSave: boolean
  sizeLabel: string
}

export function Toolbar(props: Props) {
  return (
    <div className="toolbar">
      <span className="brand" data-testid={T.brandMark}>
        <img src="/logo.svg" alt="" width={22} height={22} />
        comfy-edit
      </span>

      <button onClick={props.onPickFile}>Open image…</button>

      <button data-testid={T.btnOpenFolder} onClick={props.onPickFolder}>
        Open from folder…
      </button>

      <button data-testid={T.btnSaveImage} disabled={!props.canSave} onClick={props.onSave}>
        Save image…
      </button>

      <span className="status">|</span>

      {TOOLS.map((t) => (
        <button
          key={t.id}
          data-testid={t.testId}
          data-selected={props.tool === t.id}
          onClick={() => props.onTool(t.id)}
        >
          {t.label}
        </button>
      ))}

      <input
        data-testid={T.colorPicker}
        type="color"
        value={props.color}
        onChange={(e) => props.onColor(e.target.value)}
        aria-label="Color"
      />
      <input
        data-testid={T.brushSize}
        type="number"
        min={1}
        max={64}
        value={props.width}
        onChange={(e) => props.onWidth(Number(e.target.value))}
        aria-label="Stroke width"
        style={{ width: 64 }}
      />

      <span className="status">|</span>

      <button data-testid={T.btnUndo} disabled={!props.canUndo} onClick={props.onUndo}>
        Undo
      </button>
      <button data-testid={T.btnRedo} disabled={!props.canRedo} onClick={props.onRedo}>
        Redo
      </button>
      <button data-testid={T.btnClear} disabled={!props.hasShapes} onClick={props.onClear}>
        Clear
      </button>

      <span className="status" data-testid={T.canvasSize}>
        {props.sizeLabel}
      </span>
    </div>
  )
}
