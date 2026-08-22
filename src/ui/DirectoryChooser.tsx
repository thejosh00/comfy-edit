import { useEffect } from 'react'
import type { ChooserState } from './useEditor'
import { T } from '../testids'

type Props = {
  chooser: ChooserState
  /** Move to a directory. Null asks the server for the home directory. */
  onBrowse: (path?: string | null) => void
  onEditPath: (path: string) => void
  onChoose: (dir: string) => void
  onClose: () => void
}

/**
 * Pick the folder to open images from, one rung of the server's filesystem at a
 * time. A browser cannot show a native picker for a path on the machine running
 * the dev server — that dialog only ever returns files the *browser* can reach —
 * so the listing comes from our middleware and this draws it.
 *
 * The path field is not decoration: pasting a path is far quicker than clicking
 * down to it, and it is the only practical way to reach a folder outside home.
 */
export function DirectoryChooser({ chooser, onBrowse, onEditPath, onChoose, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { listing, path, loading, error } = chooser
  // Only a directory the server has confirmed can be chosen. A half-typed path in
  // the field is not yet a place.
  const canUse = !!listing && listing.path === path

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="chooser" data-testid={T.dirChooser} onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>Choose an image folder</strong>
          <button data-testid={T.dirChooserClose} onClick={onClose}>
            Close
          </button>
        </div>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            onBrowse(path)
          }}
        >
          <input
            data-testid={T.dirChooserPath}
            type="text"
            value={path}
            spellCheck={false}
            placeholder="/path/to/images"
            aria-label="Folder path"
            onChange={(e) => onEditPath(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="submit">Go</button>
          <button
            data-testid={T.dirChooserUse}
            type="button"
            disabled={!canUse}
            onClick={() => onChoose(path)}
          >
            Use this folder
          </button>
        </form>

        {error && (
          <div className="banner error" data-testid={T.dirChooserError}>
            {error}
          </div>
        )}

        <div className="chooser-list">
          {listing?.parent && (
            <button
              className="chooser-entry"
              data-testid={T.dirChooserUp}
              onClick={() => onBrowse(listing.parent)}
            >
              ../
            </button>
          )}

          {listing?.dirs.map((name) => (
            <button
              key={name}
              className="chooser-entry"
              data-testid={T.dirChooserEntry}
              data-name={name}
              // Joined here rather than on the server: one round trip instead of
              // two, and the server normalises whatever it is handed anyway.
              onClick={() => onBrowse(`${listing.path.replace(/\/$/, '')}/${name}`)}
            >
              {name}/
            </button>
          ))}

          {listing && listing.dirs.length === 0 && (
            <span className="status">No subfolders here.</span>
          )}
          {loading && !listing && <span className="status">Reading…</span>}
        </div>
      </div>
    </div>
  )
}
