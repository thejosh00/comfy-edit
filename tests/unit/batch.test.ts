import { describe, it, expect } from 'vitest'
import {
  batchSeeds,
  clampBatchCount,
  isBatchMode,
  BATCH_COUNTS,
  MAX_BATCH_COUNT,
} from '../../src/core/batch'

describe('clampBatchCount', () => {
  it('passes a count that is already in range', () => {
    expect(clampBatchCount(1)).toBe(1)
    expect(clampBatchCount(4)).toBe(4)
    expect(clampBatchCount(MAX_BATCH_COUNT)).toBe(MAX_BATCH_COUNT)
  })

  it('clamps out-of-range counts rather than queueing them', () => {
    // A runaway count is billable GPU time, so this is a real guard, not hygiene.
    expect(clampBatchCount(0)).toBe(1)
    expect(clampBatchCount(-3)).toBe(1)
    expect(clampBatchCount(MAX_BATCH_COUNT + 5)).toBe(MAX_BATCH_COUNT)
  })

  it('falls back to a single run for anything that is not a whole number', () => {
    expect(clampBatchCount(2.7)).toBe(2)
    expect(clampBatchCount(Number.NaN)).toBe(1)
    expect(clampBatchCount('4' as unknown as number)).toBe(1)
  })

  it('offers only counts it will accept', () => {
    for (const c of BATCH_COUNTS) expect(clampBatchCount(c)).toBe(c)
    expect(BATCH_COUNTS[0]).toBe(1)
    expect(BATCH_COUNTS.at(-1)).toBe(MAX_BATCH_COUNT)
  })
})

describe('isBatchMode', () => {
  it('recognises the two modes', () => {
    expect(isBatchMode('variations')).toBe(true)
    expect(isBatchMode('serial')).toBe(true)
  })

  it('rejects anything else, so a stale value cannot select a third behaviour', () => {
    expect(isBatchMode('chained')).toBe(false)
    expect(isBatchMode('')).toBe(false)
  })
})

describe('batchSeeds', () => {
  it('draws a fresh seed per run when the seed is not locked', () => {
    let n = 0
    const seeds = batchSeeds(3, 999, false, () => (n++ % 4) / 4)
    expect(seeds).toHaveLength(3)
    expect(new Set(seeds).size).toBe(3)
    // The locked seed is ignored entirely.
    expect(seeds).not.toContain(999)
  })

  it('walks up from the locked seed, so a batch is reproducible but not repetitive', () => {
    // ComfyUI caches by graph content: reusing one seed would return the same
    // cached image N times, which reads as a broken app rather than a batch.
    expect(batchSeeds(4, 100, true)).toEqual([100, 101, 102, 103])
  })

  it('leaves a single locked run on exactly the seed the user seed', () => {
    expect(batchSeeds(1, 4242, true)).toEqual([4242])
  })

  it('produces a seed per run, and only whole seeds', () => {
    for (const count of BATCH_COUNTS) {
      const unlocked = batchSeeds(count, 0, false, () => 0.5)
      const locked = batchSeeds(count, 7, true)
      expect(unlocked).toHaveLength(count)
      expect(locked).toHaveLength(count)
      for (const s of [...unlocked, ...locked]) {
        expect(Number.isSafeInteger(s)).toBe(true)
        expect(s).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('clamps the count, so it can be handed a raw control value', () => {
    expect(batchSeeds(0, 5, true)).toEqual([5])
    expect(batchSeeds(MAX_BATCH_COUNT + 3, 5, true)).toHaveLength(MAX_BATCH_COUNT)
  })
})
