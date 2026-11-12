/**
 * dsh-session-stars — Host half.
 *
 * Durable star ratings ("favorite importance") for workspace sessions.
 * Ratings live in one JSON file under the DSH home, so they survive restarts,
 * window reloads, and web-server port changes. The browser half reads and
 * writes them through a same-origin JSON route; the `session_stars` tool
 * exposes the same data to agents.
 *
 * @module dsh-session-stars
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'dsh-session-stars'

/** Required Host services; the web route additionally waits for `webServer`. */
export const inject = ['tools']

/** Same-origin route the browser half talks to. */
const ROUTE = '/session-stars'
/** Highest star count; 1..MAX_STARS rate a session, 0 clears the rating. */
const MAX_STARS = 5
/** Rating file format version. */
const FILE_VERSION = 1
/** Request-body ceiling for the browser route. */
const MAX_BODY_BYTES = 64 * 1024
/** Longest session id accepted (session ids are UUIDs, far shorter). */
const MAX_SESSION_ID_LENGTH = 200

/** One warning sink that reports each distinct failure once. */
function createLogger() {
  const seen = new Set()
  return (message, error) => {
    const key = error === undefined ? message : `${message}: ${error?.code ?? error?.message ?? String(error)}`
    if (seen.has(key)) return
    seen.add(key)
    if (error !== undefined) console.warn(`[session-stars] ${message}`, error)
    else console.warn(`[session-stars] ${message}`)
  }
}

/** Copy and validate the stored ratings map, dropping anything unexpected. */
function normalizeRatings(raw) {
  const ratings = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ratings
  for (const [sessionId, value] of Object.entries(raw)) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue
    if (sessionId.length > MAX_SESSION_ID_LENGTH) continue
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const stars = Number(value.stars)
    if (!Number.isInteger(stars) || stars < 1 || stars > MAX_STARS) continue
    const updatedAt = Number(value.updatedAt)
    ratings[sessionId] = {
      stars,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
    }
  }
  return ratings
}

/** A frozen, caller-owned copy of the current ratings. */
function snapshotRatings(ratings) {
  const copy = {}
  for (const [sessionId, value] of Object.entries(ratings)) {
    copy[sessionId] = { stars: value.stars, updatedAt: value.updatedAt }
  }
  return copy
}

/** Ordered rating rows, highest importance first, newest first on ties. */
function ratingRows(ratings) {
  return Object.entries(ratings)
    .map(([sessionId, value]) => ({ sessionId, stars: value.stars, updatedAt: value.updatedAt }))
    .sort((left, right) => right.stars - left.stars || right.updatedAt - left.updatedAt)
}

/**
 * One durable ratings map backed by a single JSON file.
 * Reads are served from memory after the first load; writes are serialized
 * and published atomically (temporary file, then rename).
 */
function createStore(file, log) {
  let ratings = {}
  let loaded = null
  let writeChain = Promise.resolve()

  function load() {
    if (loaded !== null) return loaded
    loaded = (async () => {
      try {
        const text = await readFile(file, 'utf8')
        const parsed = JSON.parse(text)
        ratings = normalizeRatings(parsed?.ratings)
      } catch (error) {
        if (error?.code !== 'ENOENT') log(`could not read ${file}`, error)
      }
    })()
    return loaded
  }

  function persist() {
    const body = JSON.stringify({ version: FILE_VERSION, updatedAt: Date.now(), ratings }, null, 2)
    writeChain = writeChain
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
        await writeFile(temporary, body, 'utf8')
        await rename(temporary, file)
      })
      .catch((error) => {
        log(`could not write ${file}`, error)
      })
    return writeChain
  }

  return {
    load,
    snapshot: () => snapshotRatings(ratings),
    async set(sessionId, stars) {
      await load()
      if (stars <= 0) delete ratings[sessionId]
      else ratings[sessionId] = { stars, updatedAt: Date.now() }
      await persist()
      return snapshotRatings(ratings)
    },
  }
}

/** Answer one JSON response with no-store caching. */
function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Read a bounded UTF-8 request body. */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', reject)
  })
}

/** Refuse a cross-site POST; same-origin requests and plain HTTP clients pass. */
function isAcceptableOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  if (origin === 'null') return false
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

/** Validate one rating mutation payload. */
function readMutation(payload) {
  const sessionId = payload?.sessionId
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return { ok: false, error: 'sessionId must be a non-empty string' }
  const trimmed = sessionId.trim()
  if (trimmed.length > MAX_SESSION_ID_LENGTH) return { ok: false, error: `sessionId must be at most ${MAX_SESSION_ID_LENGTH} characters` }
  const stars = payload?.stars
  if (!Number.isInteger(stars) || stars < 0 || stars > MAX_STARS) return { ok: false, error: `stars must be an integer from 0 to ${MAX_STARS}` }
  return { ok: true, sessionId: trimmed, stars }
}

/** The browser-facing JSON route: GET the ratings, POST one rating change. */
function createRouteHandler(store, log) {
  return async function handleSessionStars(request, response) {
    try {
      if (request.method === 'GET') {
        await store.load()
        sendJson(response, 200, { ok: true, ratings: store.snapshot() })
        return
      }
      if (request.method === 'POST') {
        if (!isAcceptableOrigin(request)) {
          sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
          return
        }
        let payload
        try {
          payload = JSON.parse(await readBody(request, MAX_BODY_BYTES))
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error.message === 'request body is too large' ? error.message : 'invalid JSON body' })
          return
        }
        const mutation = readMutation(payload)
        if (!mutation.ok) {
          sendJson(response, 400, { ok: false, error: mutation.error })
          return
        }
        const ratings = await store.set(mutation.sessionId, mutation.stars)
        sendJson(response, 200, { ok: true, ratings })
        return
      }
      response.writeHead(405, { allow: 'GET, POST', 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
    } catch (error) {
      log('request failed', error)
      try {
        sendJson(response, 500, { ok: false, error: 'internal error' })
      } catch {
        response.destroy()
      }
    }
  }
}

/** The `session_stars` agent tool over the same store. */
function createTool(store) {
  return {
    name: 'session_stars',
    description: 'Read or change the star rating the user assigned to sessions. Stars mark favorite importance: 1 is low, 5 is critical. Use action "list" to read ratings, "set" to assign 1-5 stars, and "clear" to remove a rating. Omit sessionId for set and clear to use the calling session.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list', 'set', 'clear'],
        description: 'Operation to perform.',
      },
      sessionId: {
        type: 'string',
        description: 'Target session id. When omitted, set and clear use the calling session.',
      },
      stars: {
        type: 'number',
        description: 'Importance from 1 (low) to 5 (critical); required for action "set".',
      },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const action = args?.action
      await store.load()
      if (action === 'list') {
        const ratings = ratingRows(store.snapshot())
        return { ok: true, action: 'list', count: ratings.length, ratings }
      }
      const sessionId = typeof args?.sessionId === 'string' && args.sessionId.trim().length > 0
        ? args.sessionId.trim()
        : exec.agent?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) return { ok: false, error: 'sessionId is required when no calling session exists' }
      if (sessionId.length > MAX_SESSION_ID_LENGTH) return { ok: false, error: `sessionId must be at most ${MAX_SESSION_ID_LENGTH} characters` }
      if (action === 'clear') {
        await store.set(sessionId, 0)
        return { ok: true, action: 'clear', sessionId, ratings: ratingRows(store.snapshot()) }
      }
      if (action === 'set') {
        const stars = args?.stars
        if (!Number.isInteger(stars) || stars < 1 || stars > MAX_STARS) return { ok: false, error: `stars must be an integer from 1 to ${MAX_STARS}` }
        await store.set(sessionId, stars)
        return { ok: true, action: 'set', sessionId, stars, ratings: ratingRows(store.snapshot()) }
      }
      return { ok: false, error: `unknown action "${String(action)}"` }
    },
  }
}

/**
 * Register the durable ratings file, its browser route, and the agent tool.
 * @param ctx - Host context carrying the tool registry.
 */
export function apply(ctx) {
  const homePath = ctx.get('dshHomePath')
  const file = typeof homePath === 'function'
    ? homePath('session-stars.json')
    : join(homedir(), '.dsh', 'session-stars.json')
  const log = createLogger()
  const store = createStore(file, log)

  ctx.effect(() => ctx.tools.register(createTool(store)), 'session-stars: agent tool')

  // The browser and desktop compositions mount a web server; other surfaces
  // still get the file-backed tool without an HTTP route.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: ROUTE, handler: createRouteHandler(store, log) }),
      'session-stars: browser route',
    )
  })
}
