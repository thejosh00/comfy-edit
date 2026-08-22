import { useEffect } from 'react'
import { basename, displayName, localFileUrl } from '../core/localImages'
import type { FolderState } from './useEditor'
import { T } from '../testids'

type Props = {
  folder: FolderState
  onPick: (path: string) => void
  onChangeFolder: () => void
  onClose: () => void
}

function status(folder: FolderState): string {
  if (folder.error) return folder.error
  if (folder.loading && folder.images.length === 0) return 'Reading the folder…'
  if (folder.images.length === 0) return `No images in ${folder.dir ?? 'the chosen folder'}.`
  // Truncation is called out rather than passed over: a capped list looks exactly
  // like a complete one, and silently hiding files is the worse surprise.
  const capped = folder.truncated ? ' (showing the newest — there are more)' : ''
  return `${folder.images.length} images in ${folder.dir}${capped}`
}

/**
 * Pick an image out of the folder the dev server was pointed at. Thumbnails are
 * served straight from the middleware, so opening the picker costs one listing
 * request and however many images the browser decides to render — the full bytes
 * are only fetched again on the one the user actually chooses.
 */
export function FolderPicker({ folder, onPick, onChangeFolder, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* The dialog swallows clicks so picking inside it does not also dismiss it. */}
      <div className="picker" data-testid={T.folderPicker} onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>Open from folder</strong>
          <span className="row">
            <button data-testid={T.btnChangeFolder} onClick={onChangeFolder}>
              Change folder…
            </button>
            <button data-testid={T.folderPickerClose} onClick={onClose}>
              Close
            </button>
          </span>
        </div>

        <span className="status" data-testid={T.folderPickerStatus}>
          {status(folder)}
        </span>

        <div className="picker-grid" data-testid={T.folderPickerGrid}>
          {folder.images.map((image) => (
            <button
              key={image.path}
              className="picker-item"
              data-testid={T.folderPickerItem}
              data-path={image.path}
              title={displayName(image.path)}
              onClick={() => onPick(image.path)}
            >
              <img
                src={localFileUrl(folder.dir ?? '', image.path)}
                alt={displayName(image.path)}
                loading="lazy"
              />
              <span>{basename(image.path)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
