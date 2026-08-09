import { describe, it, expect } from 'vitest'
import {
  initialRunState,
  applyWsMessage,
  applyHistory,
  selectOutputImage,
  isTerminal,
  type RunState,
} from '../../src/core/comfyEvents'

const PID = 'p1'
const OTHER = 'p2'

const running = (): RunState => ({ ...initialRunState(), phase: 'running', promptId: PID })

const msg = (type: string, data: unknown) => JSON.stringify({ type, data })

describe('status', () => {
  it('updates the queue depth', () => {
    const s = applyWsMessage(running(), msg('status', { status: { exec_info: { queue_remaining: 3 } } }), PID)
    expect(s.queueRemaining).toBe(3)
  })

  it('is never filtered out, despite carrying no prompt_id', () => {
    // Filtering every message on prompt_id would silently drop this one.
    const s = applyWsMessage(running(), msg('status', { status: { exec_info: { queue_remaining: 7 } } }), PID)
    expect(s.queueRemaining).toBe(7)
  })
})

describe('progress dialects', () => {
  it('reads the legacy progress message', () => {
    const s = applyWsMessage(running(), msg('progress', { value: 2, max: 4, node: '3', prompt_id: PID }), PID)
    expect(s.progress).toBe(50)
  })

  it('reads the current progress_state message identically', () => {
    const s = applyWsMessage(
      running(),
      msg('progress_state', {
        prompt_id: PID,
        nodes: { '3': { value: 2, max: 4, state: 'running' } },
      }),
      PID,
    )
    expect(s.progress).toBe(50)
  })

  it('sums progress_state across running nodes and ignores finished ones', () => {
    const s = applyWsMessage(
      running(),
      msg('progress_state', {
        prompt_id: PID,
        nodes: {
          '3': { value: 1, max: 4, state: 'running' },
          '5': { value: 3, max: 4, state: 'running' },
          '9': { value: 4, max: 4, state: 'finished' },
        },
      }),
      PID,
    )
    expect(s.progress).toBe(50)
  })
})

describe('completion signals', () => {
  it('treats execution_success as terminal', () => {
    const s = applyWsMessage(running(), msg('execution_success', { prompt_id: PID }), PID)
    expect(s.phase).toBe('done')
    expect(isTerminal(s)).toBe(true)
  })

  it('treats the legacy executing with a null node as terminal', () => {
    // Older builds' only completion signal. Missing this hangs against a real box.
    const s = applyWsMessage(running(), msg('executing', { node: null, prompt_id: PID }), PID)
    expect(s.phase).toBe('done')
    expect(isTerminal(s)).toBe(true)
  })

  it('treats executing with a real node id as progress, not completion', () => {
    const s = applyWsMessage(running(), msg('executing', { node: '3', display_node: '3', prompt_id: PID }), PID)
    expect(s.phase).toBe('running')
    expect(s.node).toBe('3')
    expect(isTerminal(s)).toBe(false)
  })
})

describe('errors', () => {
  it('carries the exception message from execution_error', () => {
    const s = applyWsMessage(
      running(),
      msg('execution_error', {
        prompt_id: PID,
        node_id: '3',
        exception_message: 'value not in list: qwen.safetensors',
      }),
      PID,
    )
    expect(s.phase).toBe('error')
    expect(s.error).toContain('value not in list')
    expect(isTerminal(s)).toBe(true)
  })

  it('treats execution_interrupted as terminal', () => {
    const s = applyWsMessage(running(), msg('execution_interrupted', { prompt_id: PID }), PID)
    expect(isTerminal(s)).toBe(true)
  })
})

describe('cross-prompt isolation', () => {
  it('ignores messages belonging to another prompt', () => {
    // A reused client id across tabs otherwise delivers another tab's events.
    const before = running()
    const after = applyWsMessage(before, msg('execution_success', { prompt_id: OTHER }), PID)
    expect(after).toEqual(before)
  })

  it('ignores another prompt progress', () => {
    const s = applyWsMessage(running(), msg('progress', { value: 9, max: 10, prompt_id: OTHER }), PID)
    expect(s.progress).toBeNull()
  })
})

describe('malformed input', () => {
  it('ignores unparseable frames rather than throwing', () => {
    const before = running()
    expect(applyWsMessage(before, 'not json', PID)).toEqual(before)
    expect(applyWsMessage(before, JSON.stringify({ nope: true }), PID)).toEqual(before)
  })

  it('ignores unknown message types', () => {
    const before = running()
    expect(applyWsMessage(before, msg('b_preview', { prompt_id: PID }), PID)).toEqual(before)
  })
})

describe('applyHistory', () => {
  it('treats an empty object as still running, not as failure', () => {
    // /history returns {} with HTTP 200 while queued — never a 404.
    const s = applyHistory(running(), {}, PID)
    expect(s.phase).toBe('running')
    expect(isTerminal(s)).toBe(false)
  })

  it('completes when the prompt id key appears', () => {
    const s = applyHistory(
      running(),
      {
        [PID]: {
          outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
          status: { status_str: 'success', completed: true },
        },
      },
      PID,
    )
    expect(s.phase).toBe('done')
    expect(s.images).toEqual([{ filename: 'out.png', subfolder: '', type: 'output' }])
  })

  it('reports a failed run recorded in history', () => {
    const s = applyHistory(
      running(),
      { [PID]: { outputs: {}, status: { status_str: 'error', completed: false } } },
      PID,
    )
    expect(s.phase).toBe('error')
  })

  it('extracts the exception message from history status messages', () => {
    // History can reach the client before the websocket's execution_error does,
    // so the reason has to be recoverable from history alone or the user sees a
    // generic "the workflow failed" instead of the actual cause.
    const s = applyHistory(
      running(),
      {
        [PID]: {
          outputs: {},
          status: {
            status_str: 'error',
            completed: false,
            messages: [
              ['execution_start', { prompt_id: PID }],
              ['execution_error', { exception_message: 'CUDA out of memory' }],
            ],
          },
        },
      },
      PID,
    )
    expect(s.phase).toBe('error')
    expect(s.error).toContain('CUDA out of memory')
  })

  it('prefers an error already reported over the history one', () => {
    const withError: RunState = { ...running(), phase: 'error', error: 'from the websocket' }
    const s = applyHistory(
      withError,
      {
        [PID]: {
          outputs: {},
          status: {
            status_str: 'error',
            completed: false,
            messages: [['execution_error', { exception_message: 'from history' }]],
          },
        },
      },
      PID,
    )
    expect(s.error).toBe('from the websocket')
  })
})

describe('selectOutputImage', () => {
  it('skips PreviewImage temp outputs and returns the real result', () => {
    const entry = {
      outputs: {
        '8': { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] },
        '9': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] },
      },
    }
    expect(selectOutputImage(entry)).toEqual({
      filename: 'result.png',
      subfolder: '',
      type: 'output',
    })
  })

  it('takes the last output when several nodes save images', () => {
    const entry = {
      outputs: {
        '9': { images: [{ filename: 'first.png', subfolder: '', type: 'output' }] },
        '10': { images: [{ filename: 'last.png', subfolder: '', type: 'output' }] },
      },
    }
    expect(selectOutputImage(entry)?.filename).toBe('last.png')
  })

  it('returns null when there is no output image at all', () => {
    expect(selectOutputImage({ outputs: {} })).toBeNull()
    expect(
      selectOutputImage({
        outputs: { '8': { images: [{ filename: 'p.png', subfolder: '', type: 'temp' }] } },
      }),
    ).toBeNull()
    expect(selectOutputImage(null)).toBeNull()
  })
})
