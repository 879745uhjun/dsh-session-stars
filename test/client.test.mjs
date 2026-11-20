import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

const templates = {
  'selftest.pass': '通过',
  'selftest.fail': '失败',
  'selftest.skip': '跳过',
  'selftest.item.ratings': '评级接口',
  'selftest.item.events': '实时事件流',
  'selftest.item.tool': 'session_stars 工具',
  'selftest.summary': '{pass} 通过 · {fail} 失败 · {skip} 跳过',
  'selftest.detail.badPayload': '响应内容不符合预期',
  'selftest.detail.ratingsShape': 'ratings 不是对象',
  'selftest.detail.ratingCount': '{count} 个已评级会话',
  'selftest.detail.toolMissing': '{tool} 未注册',
  'selftest.detail.timeout': '2 秒内未完成',
  'selftest.detail.noEventSource': '当前环境不支持 EventSource',
  'selftest.detail.eventsTimeout': '2 秒内没有收到事件',
  'selftest.detail.eventsUnavailable': '事件流不可用',
  'selftest.markdown.title': '自检 · {plugin}',
  'selftest.markdown.passLine': '- [x] {label} — 通过',
  'selftest.markdown.failLine': '- [ ] {label} — 失败：{detail}',
  'selftest.markdown.skipLine': '- [ ] {label} — 跳过',
}

function createTranslator() {
  return (key, params = {}) => (templates[key] ?? key)
    .replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
  }
}

class EmittingEventSource {
  constructor() {
    this.handlers = new Map()
  }

  addEventListener(name, listener) {
    this.handlers.set(name, listener)
    if (name === 'ratings') setTimeout(() => listener({ data: '{}' }), 0)
  }

  removeEventListener() {}

  close() {}
}

class SilentEventSource {
  addEventListener() {}

  removeEventListener() {}

  close() {}
}

function createReactStub() {
  return {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props ?? {}), children },
    }),
    Fragment: Symbol('Fragment'),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

function createDocumentStub() {
  return {
    createElement: () => ({
      setAttribute() {},
      remove() {},
      textContent: '',
    }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  }
}

function createWindowStub() {
  return {
    __DSH_SESSION_STARS_TEST__: true,
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1200,
    innerHeight: 800,
    setTimeout,
    clearTimeout,
  }
}

function loadClient() {
  const window = createWindowStub()
  const sandbox = {
    window,
    document: createDocumentStub(),
    console,
    fetch: async () => response(200, { ok: true, ratings: {} }),
    EventSource: EmittingEventSource,
    AbortController,
    setTimeout,
    clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
  }
  sandbox.globalThis = sandbox
  let captured = null
  window.__ModuleLoader__ = {
    load(definition) {
      captured = definition
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.ok(captured, 'client module registered a factory')
  assert.equal(captured.id, 'dsh-session-stars')
  const plugin = captured.factory((name) => {
    assert.equal(name, 'react', 'the factory only requires react')
    return createReactStub()
  })
  return { plugin, window }
}

function createFakeCtx() {
  const registrations = []
  const ctx = {
    effect(factory) {
      const dispose = factory()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: { register: () => () => {} },
    slots: {
      inject(_key, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, registrations }
}

const { plugin, window } = loadClient()
const api = window.__DSH_SESSION_STARS_TEST_API__
assert.ok(api, 'test API exposed')
const t = createTranslator()

// 1) Registration metadata, component wiring, and the subject filter.
{
  const { ctx, registrations } = createFakeCtx()
  plugin.apply(ctx)
  const section = registrations.find((entry) => entry.options.name === 'plugins.detail.section')
  assert.ok(section, 'self-test slot registered')
  assert.equal(section.options.id, 'dsh-session-stars.selftest', 'slot id')
  assert.equal(section.options.order, 90, 'slot order')
  assert.equal(section.options.locale, 'session-stars', 'locale namespace')
  assert.equal(typeof section.component, 'function', 'component registered')
  assert.equal(api.matchesSelfTestSubject({ kind: 'bundle', pkg: { name: 'dsh-session-stars' } }), true)
  assert.equal(api.matchesSelfTestSubject({ kind: 'bundle', pkg: { name: 'dsh-session-todos' } }), false)
  assert.equal(api.matchesSelfTestSubject(undefined), false)
  assert.equal(api.zh['selftest.title'], '自检')
  assert.equal(api.en['selftest.title'], 'Self-test')
  console.log('ok - client self-test registration metadata')
}

// 2) All checks pass against healthy endpoints.
{
  const healthyFetch = async (url) => {
    if (url === '/session-stars') return response(200, { ok: true, ratings: { a: { stars: 3 }, b: { stars: 5 } } })
    if (url === '/session-stars/health') return response(200, { ok: true, tool: 'session_stars', registered: true })
    return response(404, { ok: false })
  }
  const result = await api.runSelfTest({ fetch: healthyFetch, EventSource: EmittingEventSource, t })
  assert.equal(result.items.map((item) => item.status).join(','), 'pass,pass,pass')
  assert.deepEqual({ ...result.summary }, { pass: 3, fail: 0, skip: 0 })
  assert.equal(result.items[0].detail, '2 个已评级会话')
  assert.match(result.markdown, /## 自检 · dsh-session-stars/)
  assert.match(result.markdown, /- \[x\] 评级接口 — 通过/)
  console.log('ok - client self-test success path')
}

// 3) A 404 on one endpoint fails only that item.
{
  const ratings404 = async (url) => {
    if (url === '/session-stars') return response(404, { ok: false })
    return response(200, { ok: true, tool: 'session_stars', registered: true })
  }
  const ratingsDown = await api.runSelfTest({ fetch: ratings404, EventSource: EmittingEventSource, t, timeoutMs: 200 })
  assert.equal(ratingsDown.items[0].status, 'fail')
  assert.equal(ratingsDown.items[0].detail, 'HTTP 404')
  assert.equal(ratingsDown.items[1].status, 'pass')
  assert.equal(ratingsDown.items[2].status, 'pass')

  const health404 = async (url) => {
    if (url === '/session-stars/health') return response(404, { ok: false })
    return response(200, { ok: true, ratings: {} })
  }
  const toolDown = await api.runSelfTest({ fetch: health404, EventSource: EmittingEventSource, t, timeoutMs: 200 })
  assert.equal(toolDown.items[0].status, 'pass')
  assert.equal(toolDown.items[2].status, 'fail')
  assert.equal(toolDown.items[2].detail, 'HTTP 404')
  console.log('ok - client self-test isolates a single failure')
}

// 4) A never-settling endpoint times out without blocking the page.
{
  const result = await api.runSelfTest({
    fetch: () => new Promise(() => {}),
    EventSource: SilentEventSource,
    t,
    timeoutMs: 40,
  })
  assert.equal(result.items[0].status, 'fail')
  assert.equal(result.items[0].detail, '2 秒内未完成')
  assert.equal(result.items[1].status, 'skip')
  assert.equal(result.items[1].detail, '2 秒内没有收到事件')
  assert.equal(result.items[2].status, 'fail')
  assert.deepEqual({ ...result.summary }, { pass: 0, fail: 2, skip: 1 })

  const markdown = api.buildSelfTestMarkdown([
    { id: 'a', label: 'L-A', status: 'pass' },
    { id: 'b', label: 'L-B', status: 'fail', detail: 'boom' },
    { id: 'c', label: 'L-C', status: 'skip' },
  ], t)
  assert.match(markdown, /## 自检 · dsh-session-stars/)
  assert.match(markdown, /- \[x\] L-A — 通过/)
  assert.match(markdown, /- \[ \] L-B — 失败：boom/)
  assert.match(markdown, /- \[ \] L-C — 跳过/)
  console.log('ok - client self-test timeout and Markdown shape')
}
