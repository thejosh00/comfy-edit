/**
 * The single source of truth for E2E selectors, imported by both components and specs.
 * A renamed selector is therefore a compile error, not a silently-skipped test.
 */
export const T = {
  appRoot: 'app-root',

  // Workspace
  imageDropZone: 'image-drop-zone',
  fileInput: 'file-input',
  editorCanvas: 'editor-canvas',
  canvasSize: 'canvas-size',
  loadError: 'load-error',

  // Toolbar
  toolFreehand: 'tool-freehand',
  toolLine: 'tool-line',
  toolRect: 'tool-rect',
  toolEllipse: 'tool-ellipse',
  colorPicker: 'color-picker',
  brushSize: 'brush-size',
  btnUndo: 'btn-undo',
  btnRedo: 'btn-redo',
  btnClear: 'btn-clear',
  btnOpenFolder: 'btn-open-folder',

  // Server-folder picker
  folderPicker: 'folder-picker',
  folderPickerGrid: 'folder-picker-grid',
  // One per image, distinguished by data-path — the historyEntry pattern.
  folderPickerItem: 'folder-picker-item',
  folderPickerStatus: 'folder-picker-status',
  folderPickerClose: 'folder-picker-close',
  btnChangeFolder: 'btn-change-folder',

  // Folder chooser
  dirChooser: 'dir-chooser',
  dirChooserPath: 'dir-chooser-path',
  // One per subdirectory, distinguished by data-name.
  dirChooserEntry: 'dir-chooser-entry',
  dirChooserUp: 'dir-chooser-up',
  dirChooserUse: 'dir-chooser-use',
  dirChooserError: 'dir-chooser-error',
  dirChooserClose: 'dir-chooser-close',

  // Save
  btnSaveImage: 'btn-save-image',
  saveDialog: 'save-dialog',
  saveDialogName: 'save-dialog-name',
  saveDialogFolder: 'save-dialog-folder',
  saveDialogChangeFolder: 'save-dialog-change-folder',
  saveDialogSave: 'save-dialog-save',
  saveDialogError: 'save-dialog-error',
  saveDialogClose: 'save-dialog-close',
  saveConfirmation: 'save-confirmation',

  // Transform panel
  workflowSelect: 'workflow-select',
  workflowError: 'workflow-error',
  promptInput: 'prompt-input',
  // One per declared slot, distinguished by data-slot — the historyEntry pattern.
  loraSlot: 'lora-slot',
  loraSelect: 'lora-select',
  loraStrength: 'lora-strength',
  seedInput: 'seed-input',
  seedLock: 'seed-lock',
  runCount: 'run-count',
  runMode: 'run-mode',
  btnRun: 'btn-run',
  runStatus: 'run-status',
  runProgress: 'run-progress',
  runError: 'run-error',

  // History
  historyStrip: 'history-strip',
  historyEntry: 'history-entry',
} as const

export type TestId = (typeof T)[keyof typeof T]
