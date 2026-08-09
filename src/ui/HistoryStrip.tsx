import type { HistoryEntry, HistoryState } from '../core/history'
import { T } from '../testids'

type Props = {
  history: HistoryState
  onSelect: (id: string) => void
}

function describe(entry: HistoryEntry): string {
  if (entry.origin.kind === 'upload') {
    return `Original — ${entry.width}x${entry.height}`
  }
  const { workflowId, prompt, seed } = entry.origin
  return `${workflowId} — "${prompt}" — seed ${seed} — ${entry.width}x${entry.height}`
}

export function HistoryStrip({ history, onSelect }: Props) {
  return (
    <div className="history" data-testid={T.historyStrip}>
      {history.entries.length === 0 && (
        <span className="status">No images yet — open or paste one to start.</span>
      )}

      {history.entries.map((entry) => (
        <button
          key={entry.id}
          className="history-entry"
          data-testid={T.historyEntry}
          data-entry-id={entry.id}
          data-selected={entry.id === history.currentId}
          title={describe(entry)}
          onClick={() => onSelect(entry.id)}
        >
          <img src={entry.src} alt={describe(entry)} />
          {entry.label}
        </button>
      ))}
    </div>
  )
}
