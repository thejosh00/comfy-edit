/**
 * Fake ComfyUI. Implements exactly the surface described in
 * specs/001-comfy-edit/contracts/comfyui-api.md — no more, so it stays a contract
 * test rather than a stub.
 *
 * It asserts the client's side of the contract (upload field name, no hand-set
 * Content-Type, a queued graph referencing a real uploaded file) so a broken client
 * fails loudly instead of quietly producing output.
 *
 * Test-control endpoints under /__test/* remove every sleep from the E2E suite.
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { borderedPng, pngSize } from './png.mjs'

const portArg = process.argv.indexOf('--port')
const PORT = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8199

const MAGENTA = [255, 0, 255]
const BLACK = [0, 0, 0]

/** @type {Map<string, Buffer>} uploaded input images by filename */
const uploads = new Map()
/** @type {Map<string, Buffer>} generated output images by filename */
const outputs = new Map()
/** @type {Map<string, object>} history entries by prompt_id */
const history = new Map()
/** @type {Array<{promptId: string, graph: object}>} every graph that was queued */
const queued = []

const DEFAULT_CONFIG = {
  mode: 'instant', // 'instant' | 'stepped'
  steps: 4,
  protocol: 'progress_state', // 'progress_state' | 'progress'
  completion: 'execution_success', // 'execution_success' | 'legacy_null'
  failWith: null, // string -> execution_error with this message
  rejectWith: null, // string -> POST /prompt responds 400 with this message
  dropWsAfter: null, // number -> close the socket after N messages
  neverComplete: false, // queue the job but never finish it (timeout testing)
}
let config = { ...DEFAULT_CONFIG }

let promptCounter = 0
/** @type {Set<import('ws').WebSocket>} */
const sockets = new Set()
/** @type {null | {promptId: string, step: number, size: {width:number,height:number}}} */
let pending = null

// --- helpers ---------------------------------------------------------------

function json(res, code, body) {
  const payload = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

/** Extract the first file part of a multipart body. Enough for one-file uploads. */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '')
  if (!m) return null
  const boundary = `--${m[1] || m[2]}`
  const parts = buf.toString('latin1').split(boundary)
  const fields = {}
  let file = null

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue
    const headers = part.slice(0, headerEnd)
    const nameMatch = /name="([^"]+)"/.exec(headers)
    if (!nameMatch) continue
    const filenameMatch = /filename="([^"]*)"/.exec(headers)
    // Body runs to the trailing CRLF before the next boundary.
    const body = part.slice(headerEnd + 4).replace(/\r\n$/, '')
    if (filenameMatch) {
      file = { field: nameMatch[1], filename: filenameMatch[1], data: Buffer.from(body, 'latin1') }
    } else {
      fields[nameMatch[1]] = body
    }
  }
  return { fields, file }
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data })
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(msg)
  }
}

let sentSinceQueue = 0
function emit(type, data) {
  broadcast(type, data)
  sentSinceQueue += 1
  if (config.dropWsAfter !== null && sentSinceQueue >= config.dropWsAfter) {
    for (const ws of sockets) ws.close()
  }
}

/** Produce the result image and record it in history. Terminal. */
function complete(promptId, size) {
  const filename = `comfy-edit_${String(promptCounter).padStart(5, '0')}_.png`
  outputs.set(filename, borderedPng(size.width, size.height, MAGENTA, BLACK, 20))

  history.set(promptId, {
    outputs: {
      // A PreviewImage temp output alongside the real one, exactly as ComfyUI does.
      '8': { images: [{ filename: 'preview_temp.png', subfolder: '', type: 'temp' }] },
      '9': { images: [{ filename, subfolder: '', type: 'output' }] },
    },
    status: { status_str: 'success', completed: true, messages: [] },
  })

  emit('executed', {
    node: '9',
    prompt_id: promptId,
    output: { images: [{ filename, subfolder: '', type: 'output' }] },
  })

  if (config.completion === 'legacy_null') {
    emit('executing', { node: null, prompt_id: promptId })
  } else {
    emit('execution_success', { prompt_id: promptId })
  }
  pending = null
}

function emitProgress(promptId, step, total) {
  if (config.protocol === 'progress') {
    emit('progress', { value: step, max: total, node: '3', prompt_id: promptId })
  } else {
    emit('progress_state', {
      prompt_id: promptId,
      nodes: { '3': { value: step, max: total, state: 'running' } },
    })
  }
}

/** Advance one step; complete when the last step is reached. */
function advance() {
  if (!pending) return
  const { promptId, size } = pending
  pending.step += 1

  if (config.failWith) {
    emit('execution_error', {
      prompt_id: promptId,
      node_id: '3',
      node_type: 'KSampler',
      exception_message: config.failWith,
      traceback: [],
    })
    history.set(promptId, {
      outputs: {},
      status: {
        status_str: 'error',
        completed: false,
        // ComfyUI records the failure in history too, as [name, payload] pairs.
        messages: [['execution_error', { exception_message: config.failWith }]],
      },
    })
    pending = null
    return
  }

  emitProgress(promptId, pending.step, config.steps)
  if (pending.step >= config.steps && !config.neverComplete) complete(promptId, size)
}

function runInstantly() {
  if (!pending) return
  while (pending) advance()
}

// --- HTTP ------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  // Logged so a proxy rewrite mismatch (/comfy/ws vs /ws) is diagnosable in one run.
  process.stderr.write(`[fake-comfy] ${req.method} ${path}\n`)

  if (path === '/system_stats') return json(res, 200, { system: { comfyui_version: 'fake' } })

  // --- test control ---
  if (path === '/__test/reset' && req.method === 'POST') {
    uploads.clear()
    outputs.clear()
    history.clear()
    queued.length = 0
    config = { ...DEFAULT_CONFIG }
    pending = null
    promptCounter = 0
    sentSinceQueue = 0
    return json(res, 200, { ok: true })
  }

  if (path === '/__test/config' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    config = { ...config, ...body }
    return json(res, 200, { ok: true, config })
  }

  if (path === '/__test/advance' && req.method === 'POST') {
    advance()
    return json(res, 200, { ok: true, step: pending ? pending.step : null })
  }

  if (path === '/__test/queued') {
    return json(res, 200, { queued })
  }

  // --- ComfyUI surface ---
  if (path === '/upload/image' && req.method === 'POST') {
    const buf = await readBody(req)
    const ct = req.headers['content-type'] || ''
    const parsed = parseMultipart(buf, ct)

    if (!parsed || !parsed.file) {
      return json(res, 400, { error: 'contract: no file part found in multipart body' })
    }
    if (parsed.file.field !== 'image') {
      return json(res, 400, {
        error: `contract: upload field must be named "image", got "${parsed.file.field}"`,
      })
    }
    if (!/^multipart\/form-data;\s*boundary=/i.test(ct)) {
      return json(res, 400, {
        error: `contract: Content-Type must be browser-generated multipart with a boundary, got "${ct}"`,
      })
    }

    uploads.set(parsed.file.filename, parsed.file.data)
    return json(res, 200, { name: parsed.file.filename, subfolder: '', type: 'input' })
  }

  if (path === '/prompt' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')

    if (!body.prompt || typeof body.prompt !== 'object') {
      return json(res, 400, { error: { message: 'contract: missing "prompt" object' } })
    }
    if (!body.client_id) {
      return json(res, 400, { error: { message: 'contract: missing "client_id"' } })
    }
    if (config.rejectWith) {
      return json(res, 400, {
        error: { type: 'prompt_outputs_failed_validation', message: config.rejectWith },
        node_errors: {},
      })
    }

    // The graph must reference an image we actually hold — this is what catches a
    // patchWorkflow that wrote the filename to the wrong node.
    const referenced = Object.values(body.prompt)
      .map((n) => n?.inputs?.image)
      .filter((v) => typeof v === 'string')
    const known = referenced.find((f) => uploads.has(f))
    if (!known) {
      return json(res, 400, {
        error: {
          message:
            `contract: graph references no uploaded image. ` +
            `Saw ${JSON.stringify(referenced)}, hold ${JSON.stringify([...uploads.keys()])}`,
        },
        node_errors: {},
      })
    }

    promptCounter += 1
    const promptId = `p${promptCounter}`
    queued.push({ promptId, graph: body.prompt })
    sentSinceQueue = 0

    const size = pngSize(uploads.get(known)) ?? { width: 256, height: 256 }
    pending = { promptId, step: 0, size }

    json(res, 200, { prompt_id: promptId, number: promptCounter, node_errors: {} })

    // Emit after responding so the client has its prompt_id before events arrive.
    setImmediate(() => {
      emit('status', { status: { exec_info: { queue_remaining: 1 } } })
      emit('execution_start', { prompt_id: promptId })
      emit('executing', { node: '3', display_node: '3', prompt_id: promptId })
      if (config.mode === 'instant') runInstantly()
    })
    return
  }

  if (path.startsWith('/history/')) {
    const id = path.slice('/history/'.length)
    // Empty object with HTTP 200 while queued or running — never a 404.
    return json(res, 200, history.has(id) ? { [id]: history.get(id) } : {})
  }

  if (path === '/view') {
    const filename = url.searchParams.get('filename')
    const img = outputs.get(filename)
    if (!img) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': img.length })
    return res.end(img)
  }

  res.writeHead(404)
  res.end('not found')
})

// --- WebSocket -------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://127.0.0.1:${PORT}`)
  process.stderr.write(`[fake-comfy] UPGRADE ${pathname}\n`)
  // If this ever logs /comfy/ws, the Vite proxy rewrite is not applying to upgrades.
  if (pathname !== '/ws') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws)
    ws.on('close', () => sockets.delete(ws))
    ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } } } }))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`[fake-comfy] listening on http://127.0.0.1:${PORT}\n`)
})
