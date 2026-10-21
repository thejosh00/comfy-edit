import { describe, it, expect } from 'vitest'
import { initialRunState, type RunPhase, type RunState } from '../../src/core/comfyEvents'
import { tabTitle } from '../../src/core/tabTitle'

const BASE = 'comfy-edit'

const run = (phase: RunPhase, progress: number | null = null): RunState => ({
  ...initialRunState(),
  phase,
  progress,
})

const single = { index: 1, total: 1 }

describe('tabTitle', () => {
  it('is the page title, untouched, when nothing is running', () => {
    expect(tabTitle(BASE, initialRunState(), null)).toBe(BASE)
  })

  it('leads with the progress percentage while running, as ComfyUI does', () => {
    expect(tabTitle(BASE, run('running', 45), single)).toBe('[45%] comfy-edit')
  })

  it('reads 0% before the first progress event, so the tab shows the run has begun', () => {
    expect(tabTitle(BASE, run('uploading'), single)).toBe('[0%] comfy-edit')
    expect(tabTitle(BASE, run('queued'), single)).toBe('[0%] comfy-edit')
    expect(tabTitle(BASE, run('running'), single)).toBe('[0%] comfy-edit')
  })

  it('goes back to the page title once the run has finished or failed', () => {
    expect(tabTitle(BASE, run('done', 100), null)).toBe(BASE)
    expect(tabTitle(BASE, run('error', 50), null)).toBe(BASE)
    // A failure mid-batch is not still busy, even before the batch is cleared.
    expect(tabTitle(BASE, run('error', 50), { index: 2, total: 3 })).toBe(BASE)
  })

  it('adds the batch position only when there is more than one run', () => {
    expect(tabTitle(BASE, run('running', 45), { index: 2, total: 3 })).toBe('[45%][2/3] comfy-edit')
    expect(tabTitle(BASE, run('running', 45), single)).toBe('[45%] comfy-edit')
  })

  it('stays busy in the gap between batch runs, so the tab does not flicker', () => {
    // A batch briefly reads "done" between one run and the next.
    expect(tabTitle(BASE, run('done', 100), { index: 1, total: 3 })).toBe('[100%][1/3] comfy-edit')
  })

  it('wraps whatever the page title is rather than assuming one', () => {
    expect(tabTitle('Other', run('running', 10), single)).toBe('[10%] Other')
  })
})
