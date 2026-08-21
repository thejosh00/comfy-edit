import { randomSeed } from './workflow'

/**
 * What a run of more than one means.
 *
 * - `variations` — every run starts from the same image, so the results are
 *   siblings of it and of each other. Use it to pick from several attempts.
 * - `serial` — each result is fed back in as the next run's input, so the results
 *   form a chain. Use it to refine progressively.
 */
export type BatchMode = 'variations' | 'serial'

const MODES: readonly string[] = ['variations', 'serial']

export function isBatchMode(value: string): value is BatchMode {
  return MODES.includes(value)
}

export const MAX_BATCH_COUNT = 8

/** The counts the dropdown offers. Every one of them survives clampBatchCount. */
export const BATCH_COUNTS = [1, 2, 3, 4, 6, 8] as const

/**
 * A count is a number of billable GPU runs, so an out-of-range or nonsense value
 * collapses to something safe rather than being queued as-is.
 */
export function clampBatchCount(count: number): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1
  return Math.min(Math.max(Math.floor(count), 1), MAX_BATCH_COUNT)
}

/**
 * One seed per run.
 *
 * A locked seed walks upward — `seed`, `seed+1`, … — rather than repeating. Locking
 * promises reproducibility, and a walk is reproducible; repeating the same seed
 * would instead hit ComfyUI's content cache and return the identical image N times,
 * which reads as a broken app rather than as a batch. A single locked run is
 * therefore still exactly the seed the user chose.
 */
export function batchSeeds(
  count: number,
  seed: number,
  locked: boolean,
  rng: () => number = Math.random,
): number[] {
  return Array.from({ length: clampBatchCount(count) }, (_, i) =>
    locked ? seed + i : randomSeed(rng),
  )
}
