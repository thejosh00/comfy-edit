import { useCallback, useEffect, useRef } from 'react'
import { CanvasStage } from './ui/CanvasStage'
import { Toolbar } from './ui/Toolbar'
import { TransformPanel } from './ui/TransformPanel'
import { HistoryStrip } from './ui/HistoryStrip'
import { FolderPicker } from './ui/FolderPicker'
import { DirectoryChooser } from './ui/DirectoryChooser'
import { SaveDialog } from './ui/SaveDialog'
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

  /** The canvas already holds base + marks composited exactly as the user sees them. */
  const getCanvasBlob = useCallback(async (): Promise<Blob> => {
    const canvas = canvasRef.current
    if (!canvas) throw new Error('There is no image to transform.')
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not read the canvas image.')
    return blob
  }, [])

  const onRun = useCallback(() => {
    void editor.runBatch(getCanvasBlob)
  }, [editor, getCanvasBlob])

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
        onPickFolder={editor.openFolderPicker}
        onSave={editor.openSaveDialog}
        canSave={editor.canSave}
        sizeLabel={sizeLabel}
      />

      <CanvasStage
        base={state.base}
        shapes={state.doc.shapes}
        tool={state.tool}
        color={state.color}
        width={state.width}
        onCommit={editor.commit}
        onPickColor={editor.pickColor}
        canvasRef={canvasRef}
      />

      <TransformPanel
        workflows={state.workflows}
        workflowError={state.workflowError}
        selectedId={state.selectedWorkflowId}
        prompt={state.prompt}
        seed={state.seed}
        seedLocked={state.seedLocked}
        loraSlots={editor.loraSlots}
        availableLoras={editor.availableLoras}
        loras={state.loras}
        batchCount={state.batchCount}
        batchMode={state.batchMode}
        batch={state.batch}
        run={state.run}
        runSeq={state.runSeq}
        canRun={editor.canRun}
        onSelect={editor.selectWorkflow}
        onPrompt={editor.setPrompt}
        onSeed={editor.setSeed}
        onSeedLock={editor.setSeedLock}
        onLora={editor.setLora}
        onBatchCount={editor.setBatchCount}
        onBatchMode={editor.setBatchMode}
        onRun={onRun}
      />

      <HistoryStrip history={state.history} onSelect={editor.selectHistoryEntry} />

      {state.folder.open && (
        <FolderPicker
          folder={state.folder}
          onPick={(path) => void editor.openLocalImage(path)}
          onChangeFolder={editor.openChooser}
          onClose={editor.closeFolderPicker}
        />
      )}

      {state.chooser.open && (
        <DirectoryChooser
          chooser={state.chooser}
          onBrowse={(path) => void editor.browseTo(path)}
          onEditPath={editor.editChooserPath}
          onChoose={editor.chooseFolder}
          onClose={editor.closeChooser}
        />
      )}

      {state.save.open && (
        <SaveDialog
          save={state.save}
          onName={editor.editSaveName}
          onChangeFolder={editor.changeSaveFolder}
          onSave={() => void editor.saveImage(getCanvasBlob)}
          onClose={editor.closeSaveDialog}
        />
      )}

      {state.save.savedPath && (
        <div className="banner" data-testid={T.saveConfirmation}>
          Saved to {state.save.savedPath}
        </div>
      )}

      {state.loadError && (
        <div className="banner error" data-testid={T.loadError}>
          {state.loadError}
        </div>
      )}
    </div>
  )
}
