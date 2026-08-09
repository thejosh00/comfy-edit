import { useEffect, useRef } from 'react'
import { CanvasStage } from './ui/CanvasStage'
import { Toolbar } from './ui/Toolbar'
import { useEditor } from './ui/useEditor'
import { T } from './testids'

export function App() {
  const editor = useEditor()
  const { state } = editor
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Paste anywhere on the page brings an image in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      )
      const file = item?.getAsFile()
      if (file) void editor.loadImageFile(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [editor])

  const sizeLabel = state.base ? `${state.base.width}x${state.base.height}` : ''

  return (
    <div className="app" data-testid={T.appRoot}>
      <input
        data-testid={T.fileInput}
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void editor.loadImageFile(file)
          e.target.value = ''
        }}
      />

      <Toolbar
        tool={state.tool}
        color={state.color}
        width={state.width}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        hasShapes={editor.hasShapes}
        onTool={editor.setTool}
        onColor={editor.setColor}
        onWidth={editor.setWidth}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onClear={editor.clear}
        onPickFile={() => fileRef.current?.click()}
        sizeLabel={sizeLabel}
      />

      <CanvasStage
        base={state.base}
        shapes={state.doc.shapes}
        tool={state.tool}
        color={state.color}
        width={state.width}
        onCommit={editor.commit}
        canvasRef={canvasRef}
      />

      <div className="transform">
        {state.loadError && (
          <div className="banner error" data-testid={T.loadError}>
            {state.loadError}
          </div>
        )}
      </div>
    </div>
  )
}
