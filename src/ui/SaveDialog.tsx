import { useEffect, useRef } from 'react'
import type { SaveState } from './useEditor'
import { T } from '../testids'

type Props = {
  save: SaveState
  onName: (name: string) => void
  onChangeFolder: () => void
  onSave: () => void
  onClose: () => void
}

/**
 * Name the file and write it. The folder was chosen before this opened, so the
 * only decision left is the name — which is why the field is focused and selected
 * on open: the default is usually right, and when it is not, typing replaces it.
 */
export function SaveDialog({ save, onName, onChangeFolder, onSave, onClose }: Props) {
  const nameRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const input = nameRef.current
    if (!input) return
    input.focus()
    // Up to the extension, so ".png" survives typing over the name.
    const dot = input.value.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="chooser" data-testid={T.saveDialog} onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>Save image</strong>
          <button data-testid={T.saveDialogClose} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="row">
          <span className="status" data-testid={T.saveDialogFolder}>
            {save.dir}
          </span>
          <button data-testid={T.saveDialogChangeFolder} onClick={onChangeFolder}>
            Change folder…
          </button>
        </div>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            onSave()
          }}
        >
          <input
            data-testid={T.saveDialogName}
            ref={nameRef}
            type="text"
            value={save.name}
            spellCheck={false}
            aria-label="Filename"
            onChange={(e) => onName(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button data-testid={T.saveDialogSave} type="submit" disabled={save.saving}>
            {save.saving ? 'Saving…' : 'Save'}
          </button>
        </form>

        {save.error && (
          <div className="banner error" data-testid={T.saveDialogError}>
            {save.error}
          </div>
        )}
      </div>
    </div>
  )
}
