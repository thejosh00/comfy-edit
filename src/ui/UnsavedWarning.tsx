import { useEffect } from 'react'
import { T } from '../testids'

type Props = {
  count: number
  onDiscard: () => void
  onKeep: () => void
}

/** Opening an image starts a new history, so asked before results are dropped from it. */
export function UnsavedWarning({ count, onDiscard, onKeep }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onKeep()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onKeep])

  return (
    <div className="modal-backdrop" onClick={onKeep}>
      <div className="chooser" data-testid={T.unsavedWarning} onClick={(e) => e.stopPropagation()}>
        <strong>
          {count === 1 ? '1 result has' : `${count} results have`} not been saved
        </strong>
        <p className="status">
          Opening this image starts over, and history is kept only for this session.
        </p>
        <div className="row">
          <button data-testid={T.unsavedKeep} onClick={onKeep}>
            Keep my results
          </button>
          <button data-testid={T.unsavedDiscard} onClick={onDiscard}>
            Discard and open
          </button>
        </div>
      </div>
    </div>
  )
}
