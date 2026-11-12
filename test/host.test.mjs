import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

/** Minimal Host context capturing the tool and the browser route. */
function createFakeContext(home) {
  const state = { tools: [], routes: [] }
  const disposers = []
  const ctx = {
    get(key) {
      if (key === 'dshHomePath') return (...segments) => join(home, ...segments)
      return undefined
    },
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    inject(_deps, callback) {
      callback({
        effect(factory) {
          const dispose = factory()
          if (typeof dispose === 'function') disposers.push(dispose)
          return dispose
        },
        webServer: {
          register(route) {
            state.routes.push(route)
            return () => {}
          },
        },
      })
    },
    tools: {
      register(definition) {
        state.tools.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, state, dispose: () => disposers.reverse().forEach((dispose) => dispose()) }
}

function makeRequest(method, body, headers = {}) {
  const request = new EventEmitter()
  request.method = method
  request.headers = headers
  request.destroy = () => {}
  process.nextTick(() => {
    if (body !== undefined) request.emit('data', Buffer.from(body, 'utf8'))
    request.emit('end')
  })
  return request
}

function makeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(chunk) {
      this.body = typeof chunk === 'string' ? chunk : String(chunk ?? '')
    },
    destroy() {},
  }
}

async function call(route, method, body, headers) {
  const response = makeResponse()
  await route.handler(makeRequest(method, body, headers), response)
  return { status: response.status, json: JSON.parse(response.body) }
}

const home = await mkdtemp(join(tmpdir(), 'dsh-session-stars-test-'))
try {
  const first = createFakeContext(home)
  apply(first.ctx)

  assert.equal(first.state.routes.length, 1, 'one browser route')
  assert.equal(first.state.routes[0].path, '/session-stars', 'route path')
  assert.equal(first.state.tools.length, 1, 'one agent tool')
  assert.equal(first.state.tools[0].name, 'session_stars', 'tool name')

  const initial = await call(first.state.routes[0], 'GET')
  assert.equal(initial.status, 200)
  assert.deepEqual(initial.json, { ok: true, ratings: {} })

  const crossOriginGet = await call(first.state.routes[0], 'GET', undefined, { origin: 'https://example.com', host: '127.0.0.1:57220' })
  assert.equal(crossOriginGet.status, 403)

  const rated = await call(first.state.routes[0], 'POST', JSON.stringify({ sessionId: 'session-a', stars: 4 }), { origin: 'http://127.0.0.1:57220', host: '127.0.0.1:57220' })
  assert.equal(rated.status, 200)
  assert.equal(rated.json.ratings['session-a'].stars, 4)

  const invalid = await call(first.state.routes[0], 'POST', JSON.stringify({ sessionId: 'session-a', stars: 9 }), { host: '127.0.0.1:57220' })
  assert.equal(invalid.status, 400)

  const crossOrigin = await call(first.state.routes[0], 'POST', JSON.stringify({ sessionId: 'session-a', stars: 2 }), { origin: 'https://example.com', host: '127.0.0.1:57220' })
  assert.equal(crossOrigin.status, 403)

  const cleared = await call(first.state.routes[0], 'POST', JSON.stringify({ sessionId: 'session-a', stars: 0 }), { host: '127.0.0.1:57220' })
  assert.equal(cleared.status, 200)
  assert.deepEqual(cleared.json.ratings, {})

  const tool = first.state.tools[0]
  const toolSet = await tool.execute({ action: 'set', sessionId: 'session-b', stars: 5 }, { agent: { id: 'agent-session' } })
  assert.equal(toolSet.ok, true)
  const toolList = await tool.execute({ action: 'list' }, {})
  assert.equal(toolList.ok, true)
  assert.equal(toolList.count, 1)
  assert.equal(toolList.ratings[0].sessionId, 'session-b')
  assert.equal(toolList.ratings[0].stars, 5)

  const toolDefaultSession = await tool.execute({ action: 'set', stars: 3 }, { agent: { id: 'session-c' } })
  assert.equal(toolDefaultSession.ok, true)
  assert.equal(toolDefaultSession.sessionId, 'session-c')

  const toolClear = await tool.execute({ action: 'clear', sessionId: 'session-c' }, {})
  assert.equal(toolClear.ok, true)
  const afterClear = await tool.execute({ action: 'list' }, {})
  assert.equal(afterClear.count, 1)

  const badStars = await tool.execute({ action: 'set', sessionId: 'session-b', stars: 0 }, {})
  assert.equal(badStars.ok, false)

  // A second activation over the same home must read the durable file.
  const second = createFakeContext(home)
  apply(second.ctx)
  const reloaded = await call(second.state.routes[0], 'GET')
  assert.equal(reloaded.json.ratings['session-b'].stars, 5)

  const stored = JSON.parse(await readFile(join(home, 'session-stars.json'), 'utf8'))
  assert.equal(stored.version, 1)
  assert.equal(stored.ratings['session-b'].stars, 5)

  first.dispose()
  second.dispose()
  console.log('ok - session-stars Host route, store, and tool')
} finally {
  await rm(home, { recursive: true, force: true })
}
