import type { RunState } from '../core/comfyEvents'
import { BATCH_COUNTS, isBatchMode, type BatchMode } from '../core/batch'
import { DEFAULT_LORA_STRENGTH, type LoraMeta, type LoraSelection } from '../core/loras'
import type { LoadedWorkflow } from '../comfy/client'
import { T } from '../testids'

type Props = {
  workflows: LoadedWorkflow[]
  workflowError: string | null
  selectedId: string
  prompt: string
  seed: number
  seedLocked: boolean
  /** How many LoRA slots the selected workflow declares; 0 renders no controls. */
  loraSlots: number
  availableLoras: LoraMeta[]
  loras: LoraSelection[]
  batchCount: number
  batchMode: BatchMode
  batch: { index: number; total: number } | null
  run: RunState
  runSeq: number
  canRun: boolean
  onSelect: (id: string) => void
  onPrompt: (p: string) => void
  onSeed: (s: number) => void
  onSeedLock: (locked: boolean) => void
  onLora: (slot: number, selection: LoraSelection) => void
  onBatchCount: (count: number) => void
  onBatchMode: (mode: BatchMode) => void
  onRun: () => void
}

const MODE_LABEL: Record<BatchMode, string> = {
  variations: 'Variations — each run starts from this image',
  serial: 'Refine — each run starts from the last result',
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

      {Array.from({ length: props.loraSlots }, (_, slot) => {
        const selection = props.loras[slot] ?? null
        const active = props.availableLoras.find((l) => l.file === selection?.file)
        const strength = selection?.strength ?? DEFAULT_LORA_STRENGTH

        return (
          <div className="field lora-slot" key={slot} data-testid={T.loraSlot} data-slot={slot}>
            <span>LoRA {slot + 1}</span>
            <select
              data-testid={T.loraSelect}
              data-slot={slot}
              value={active?.id ?? ''}
              onChange={(e) => {
                const lora = props.availableLoras.find((l) => l.id === e.target.value)
                props.onLora(
                  slot,
                  lora ? { file: lora.file, strength: lora.strength ?? DEFAULT_LORA_STRENGTH } : null,
                )
              }}
            >
              <option value="">None</option>
              {props.availableLoras.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <div className="row">
              <input
                data-testid={T.loraStrength}
                data-slot={slot}
                data-value={selection ? strength : 0}
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={strength}
                disabled={!selection}
                onChange={(e) =>
                  selection && props.onLora(slot, { ...selection, strength: Number(e.target.value) })
                }
              />
              <span className="status">{selection ? strength.toFixed(2) : 'off'}</span>
            </div>
          </div>
        )
      })}

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

      <label className="field">
        <span>Runs</span>
        <select
          data-testid={T.runCount}
          value={props.batchCount}
          onChange={(e) => props.onBatchCount(Number(e.target.value))}
        >
          {BATCH_COUNTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      {/* Meaningless for a single run, so it only appears once there is more than one. */}
      {props.batchCount > 1 && (
        <label className="field">
          <span>Repeat mode</span>
          <select
            data-testid={T.runMode}
            value={props.batchMode}
            onChange={(e) => isBatchMode(e.target.value) && props.onBatchMode(e.target.value)}
          >
            {(Object.keys(MODE_LABEL) as BatchMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      )}

      <button data-testid={T.btnRun} disabled={!props.canRun} onClick={props.onRun}>
        {props.batchCount > 1 ? `Run ${props.batchCount}×` : 'Run'}
      </button>

      <div
        className="status"
        data-testid={T.runStatus}
        data-phase={run.phase}
        data-run-seq={props.runSeq}
        data-batch-index={props.batch?.index ?? 0}
        data-batch-total={props.batch?.total ?? 0}
      >
        {PHASE_LABEL[run.phase]}
        {props.batch && props.batch.total > 1 ? ` ${props.batch.index}/${props.batch.total}` : ''}
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
