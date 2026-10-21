import type { RunPhase, RunState } from './comfyEvents'

const BUSY: readonly RunPhase[] = ['uploading', 'queued', 'running']

/**
 * The browser tab's title: `[45%] comfy-edit` while a run is in flight, with the
 * batch position after the percentage — `[45%][2/3] comfy-edit` — when Run repeats.
 * Same shape as ComfyUI's own tab, so progress can be watched from another tab.
 * Anything else, including a failure, is just the page's own title.
 */
export function tabTitle(
  base: string,
  run: RunState,
  batch: { index: number; total: number } | null,
): string {
  // A batch briefly reads "done" between runs; it is still busy.
  const busy = BUSY.includes(run.phase) || (batch !== null && run.phase === 'done')
  if (!busy) return base

  const position = batch && batch.total > 1 ? `[${batch.index}/${batch.total}]` : ''
  return `[${run.progress ?? 0}%]${position} ${base}`
}
