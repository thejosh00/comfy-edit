import type { RunState } from '../core/comfyEvents'
import type { LoadedWorkflow } from '../comfy/client'
import { T } from '../testids'

type Props = {
  workflows: LoadedWorkflow[]
  workflowError: string | null
  selectedId: string
  prompt: string
  seed: number
  seedLocked: boolean
  run: RunState
  runSeq: number
  canRun: boolean
  onSelect: (id: string) => void
  onPrompt: (p: string) => void
  onSeed: (s: number) => void
  onSeedLock: (locked: boolean) => void
  onRun: () => void
}

const PHASE_LABEL: Record<RunState['phase'], string> = {
  idle: 'Ready',
  uploading: 'Uploading image…',
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  error: 'Failed',
}

export function TransformPanel(props: Props) {
  const { run } = props

  return (
    <div className="transform">
      {props.workflowError && (
        <div className="banner error" data-testid={T.workflowError}>
          {props.workflowError}
        </div>
      )}

      <label className="field">
        <span>Workflow</span>
        <select
          data-testid={T.workflowSelect}
          value={props.selectedId}
          onChange={(e) => props.onSelect(e.target.value)}
        >
          {props.workflows.map(({ meta }) => (
            <option key={meta.id} value={meta.id}>
              {meta.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Instruction</span>
        <textarea
          data-testid={T.promptInput}
          rows={4}
          value={props.prompt}
          onChange={(e) => props.onPrompt(e.target.value)}
          placeholder="describe the change you want"
        />
      </label>

      <label className="field">
        <span>Seed</span>
        <input
          data-testid={T.seedInput}
          type="number"
          value={props.seed}
          onChange={(e) => props.onSeed(Number(e.target.value))}
        />
      </label>

      <label className="row">
        <input
          data-testid={T.seedLock}
          type="checkbox"
          checked={props.seedLocked}
          onChange={(e) => props.onSeedLock(e.target.checked)}
        />
        <span className="status">Lock seed (reproducible)</span>
      </label>

      <button data-testid={T.btnRun} disabled={!props.canRun} onClick={props.onRun}>
        Run
      </button>

      <div
        className="status"
        data-testid={T.runStatus}
        data-phase={run.phase}
        data-run-seq={props.runSeq}
      >
        {PHASE_LABEL[run.phase]}
        {run.node && run.phase === 'running' ? ` — node ${run.node}` : ''}
        {run.queueRemaining ? ` (${run.queueRemaining} ahead)` : ''}
      </div>

      <progress
        data-testid={T.runProgress}
        data-value={run.progress ?? 0}
        value={run.progress ?? 0}
        max={100}
      />

      {run.error && (
        <div className="banner error" data-testid={T.runError}>
          {run.error}
        </div>
      )}
    </div>
  )
}
