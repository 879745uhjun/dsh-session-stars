/**
 * dsh-session-stars — browser half.
 *
 * Adds a 1-5 star importance rating to every session row in the workspace
 * browser:
 *  - a hover action in `sidebar.workspaces.session.row.action` and a row-menu
 *    item in `sidebar.workspaces.session.menu.item` open one compact picker;
 *  - a five-star gauge in `sidebar.session.row.trailing` shows the rating at a
 *    glance, colored by importance and tinted for 4-5 stars;
 *  - the session hover card gains the same gauge plus the localized level;
 *  - the picker offers the stars and a five-step importance scale.
 *
 * Ratings are durable Host data read and written through the same-origin
 * `/session-stars` JSON route; `/session-stars/events` pushes changes to every
 * open window over Server-Sent Events. Visible copy comes from the Client
 * locale service; styling uses only theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-stars',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'session-stars'
    const ENDPOINT = '/session-stars'
    const EVENTS = '/session-stars/events'
    const MAX_STARS = 5
    const CARD_WIDTH = 300
    const CARD_HEIGHT = 268
    const VIEWPORT_MARGIN = 8
    const SAVED_MS = 1600
    const LEVEL_KEY = ['', 'level.1', 'level.2', 'level.3', 'level.4', 'level.5']

    const EN = {
      'action.unrated': 'Set importance stars',
      'action.rated': 'Importance {stars} of 5: {level}',
      'menu.item': 'Importance…',
      'badge.title': 'Importance {stars} of 5: {level}',
      'hover.label': 'Importance',
      'dialog.title': 'Favorite importance',
      'dialog.hint': 'Pick 1-5 stars. More stars mark a more important session.',
      'dialog.scale': 'Importance level',
      'dialog.current': '{stars} of 5 · {level}',
      'dialog.empty': 'Not rated yet',
      'dialog.clear': 'Clear rating',
      'dialog.close': 'Close',
      'dialog.star': '{stars} of 5: {level}',
      'dialog.saved': 'Saved',
      'level.1': 'Low',
      'level.2': 'Minor',
      'level.3': 'Important',
      'level.4': 'Very important',
      'level.5': 'Critical',
      'error.load': 'Ratings are unavailable',
      'error.save': 'Could not save the rating',
    }

    const ZH = {
      'action.unrated': '设置收藏星级',
      'action.rated': '重要度 {stars}/5：{level}',
      'menu.item': '重要度…',
      'badge.title': '重要度 {stars}/5：{level}',
      'hover.label': '重要度',
      'dialog.title': '收藏重要度',
      'dialog.hint': '选择 1-5 星，星级越高表示这个会话越重要。',
      'dialog.scale': '重要度等级',
      'dialog.current': '{stars}/5 · {level}',
      'dialog.empty': '尚未评级',
      'dialog.clear': '清除评级',
      'dialog.close': '关闭',
      'dialog.star': '{stars}/5：{level}',
      'dialog.saved': '已保存',
      'level.1': '低',
      'level.2': '一般',
      'level.3': '重要',
      'level.4': '很重要',
      'level.5': '关键',
      'error.load': '星级暂时不可用',
      'error.save': '星级保存失败',
    }

    /* ------------------------------------------------------------------ *
     * Ratings store (Host-backed, optimistic writes, live server pushes)
     * ------------------------------------------------------------------ */

    function normalizeRatings(value) {
      const ratings = {}
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return ratings
      for (const [sessionId, entry] of Object.entries(value)) {
        if (typeof sessionId !== 'string' || sessionId.length === 0) continue
        if (entry === null || typeof entry !== 'object') continue
        const stars = Number(entry.stars)
        if (!Number.isInteger(stars) || stars < 1 || stars > MAX_STARS) continue
        ratings[sessionId] = { stars, updatedAt: Number(entry.updatedAt) || 0 }
      }
      return ratings
    }

    function createRatingsStore() {
      let state = { status: 'loading', ratings: {} }
      const listeners = new Set()
      let inflight = null
      let pending = 0
      let chain = Promise.resolve()
      let warned = false

      function publish(next) {
        state = next
        for (const listener of listeners) listener()
      }

      function report(error) {
        if (warned) return
        warned = true
        console.warn('[session-stars] ratings route failed:', error)
      }

      /** Apply a server push unless a local write is still in flight. */
      function applyServer(raw) {
        if (pending > 0) return
        publish({ status: 'ready', ratings: normalizeRatings(raw) })
      }

      function refresh() {
        if (inflight !== null) return inflight
        inflight = (async () => {
          try {
            const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'invalid response')
            if (pending === 0) publish({ status: 'ready', ratings: normalizeRatings(payload.ratings) })
          } catch (error) {
            report(error)
            publish({ status: state.status === 'ready' ? 'ready' : 'error', ratings: state.ratings })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      async function write(sessionId, stars) {
        pending += 1
        const previous = state.ratings
        const optimistic = { ...previous }
        if (stars > 0) optimistic[sessionId] = { stars, updatedAt: Date.now() }
        else delete optimistic[sessionId]
        publish({ status: state.status === 'ready' ? 'ready' : 'error', ratings: optimistic })
        try {
          const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId, stars }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`)
          publish({ status: 'ready', ratings: normalizeRatings(payload.ratings) })
          warned = false
          return { ok: true }
        } catch (error) {
          publish({ status: state.status === 'ready' ? 'ready' : 'error', ratings: previous })
          report(error)
          return { ok: false, error }
        } finally {
          pending -= 1
        }
      }

      /** Serialize writes so rapid clicks cannot reorder their responses. */
      function setRating(sessionId, stars) {
        const run = chain.then(() => write(sessionId, stars))
        chain = run.then(() => undefined, () => undefined)
        return run
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        refresh,
        setRating,
        applyServer,
      }
    }

    const ratingsStore = createRatingsStore()

    function useRatingsState() {
      return useSyncExternalStore(ratingsStore.subscribe, ratingsStore.getSnapshot, ratingsStore.getSnapshot)
    }

    function useStars(sessionId) {
      const state = useRatingsState()
      return state.ratings[sessionId]?.stars ?? 0
    }

    /* ------------------------------------------------------------------ *
     * Editor request store (one open picker at a time)
     * ------------------------------------------------------------------ */

    function createEditorStore() {
      let state = null
      const listeners = new Set()
      const publish = () => {
        for (const listener of listeners) listener()
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        open(request) {
          state = request
          publish()
        },
        close() {
          if (state === null) return
          state = null
          publish()
        },
      }
    }

    const editorStore = createEditorStore()

    function useEditorRequest() {
      return useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot)
    }

    /* ------------------------------------------------------------------ *
     * Presentation helpers
     * ------------------------------------------------------------------ */

    function levelText(t, stars) {
      return stars > 0 ? t(LEVEL_KEY[stars]) : t('dialog.empty')
    }

    function cardPosition(rect) {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      let left = rect.right - CARD_WIDTH
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - CARD_WIDTH - VIEWPORT_MARGIN))
      let top = rect.bottom + 6
      if (top + CARD_HEIGHT > viewportHeight - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, rect.top - CARD_HEIGHT - 6)
      }
      return { left, top, width: CARD_WIDTH }
    }

    function openEditor(sessionId, title, rect) {
      editorStore.open({
        sessionId,
        title: typeof title === 'string' ? title : '',
        rect,
      })
    }

    function StarGlyph({ size = 12, filled = false, className }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          className,
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.4l-5.7 3-1-6.4-4.6-4.5 6.4-.9z',
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: filled ? 0.6 : 1.6,
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Five stars: filled up to `stars`, faint outlines for the rest. */
    function StarGauge({ stars, size = 8 }) {
      return h(
        'span',
        { className: 'dsss-gauge', 'aria-hidden': true },
        Array.from({ length: MAX_STARS }, (_value, index) => {
          const on = index < stars
          return h(
            'span',
            { key: index, className: on ? 'dsss-gauge__star is-on' : 'dsss-gauge__star is-off' },
            h(StarGlyph, { size, filled: on }),
          )
        }),
      )
    }

    function CloseGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M4 4l8 8M12 4l-8 8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      )
    }

    /* ------------------------------------------------------------------ *
     * Components
     * ------------------------------------------------------------------ */

    /** Non-interactive five-star importance gauge after the row's time label. */
    function SessionStarBadge({ sessionId, t }) {
      const stars = useStars(sessionId)
      if (stars === 0) return null
      const level = levelText(t, stars)
      const label = t('badge.title', { stars: String(stars), level })
      return h(
        'span',
        {
          className: stars >= 4 ? `dsss-badge is-strong dsss-tier-${stars}` : `dsss-badge dsss-tier-${stars}`,
          title: label,
          'aria-label': label,
          role: 'img',
        },
        h(StarGauge, { stars, size: 8 }),
      )
    }

    /** Hover action: one star button that opens the picker for its row. */
    function SessionStarAction({ sessionId, displayTitle, t }) {
      const stars = useStars(sessionId)
      const level = levelText(t, stars)
      const label = stars > 0
        ? t('action.rated', { stars: String(stars), level })
        : t('action.unrated')
      return h(
        'button',
        {
          type: 'button',
          className: stars > 0
            ? `dsss-actionButton is-rated dsss-tier-${stars}`
            : 'dsss-actionButton',
          title: label,
          'aria-label': label,
          'aria-haspopup': 'dialog',
          onPointerDown: (event) => {
            event.stopPropagation()
          },
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            openEditor(sessionId, displayTitle, event.currentTarget.getBoundingClientRect())
          },
        },
        h(StarGlyph, { size: 14, filled: stars > 0 }),
      )
    }

    /** Row menu item: opens the same picker without hovering. */
    function SessionStarMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
      const stars = useStars(sessionId)
      const level = levelText(t, stars)
      const useMenu = typeof useMenuOpenState === 'function' ? useMenuOpenState : () => [false, () => {}]
      const [, setMenuOpen] = useMenu()
      const label = stars > 0
        ? t('action.rated', { stars: String(stars), level })
        : t('action.unrated')
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: stars > 0 ? `dsss-menu-item dsss-tier-${stars}` : 'dsss-menu-item',
          title: label,
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            setMenuOpen(false)
            openEditor(sessionId, displayTitle, rect)
          },
        },
        h('span', { className: 'dsss-menu-item__icon' }, h(StarGlyph, { size: 14, filled: stars > 0 })),
        h('span', { className: 'dsss-menu-item__label', children: t('menu.item') }),
        stars > 0 ? h('span', { className: 'dsss-menu-item__meta', children: `${stars}/5` }) : null,
      )
    }

    /** Section of the session hover card: the gauge plus the localized level. */
    function SessionStarHover({ sessionId, t }) {
      const stars = useStars(sessionId)
      if (stars === 0) return null
      return h(
        'div',
        { className: `dsss-hover dsss-tier-${stars}` },
        h(StarGauge, { stars, size: 12 }),
        h('span', { className: 'dsss-chip', children: `${stars}/5 · ${levelText(t, stars)}` }),
      )
    }

    /** The one open importance picker, rendered in the frame-wide overlay. */
    function SessionStarDialog({ t }) {
      const request = useEditorRequest()
      const state = useRatingsState()
      const [hovered, setHovered] = useState(0)
      const [failure, setFailure] = useState(false)
      const [saved, setSaved] = useState(false)
      const cardRef = useRef(null)
      const savedTimer = useRef(0)

      const sessionId = request === null ? null : request.sessionId
      useEffect(() => {
        if (sessionId === null) return undefined
        setHovered(0)
        setFailure(false)
        setSaved(false)
        const frame = requestAnimationFrame(() => {
          if (cardRef.current !== null) cardRef.current.focus({ preventScroll: true })
        })
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          editorStore.close()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          cancelAnimationFrame(frame)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [sessionId])

      useEffect(() => () => window.clearTimeout(savedTimer.current), [])

      if (request === null) return null

      const stars = state.ratings[request.sessionId]?.stars ?? 0
      const level = levelText(t, stars)
      const active = hovered > 0 ? hovered : stars
      const unavailable = state.status === 'error'

      const select = async (value) => {
        setFailure(false)
        const result = await ratingsStore.setRating(request.sessionId, value)
        if (!result.ok) {
          setFailure(true)
          return
        }
        setSaved(true)
        window.clearTimeout(savedTimer.current)
        savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_MS)
      }

      return h(
        React.Fragment,
        null,
        h('div', {
          key: 'backdrop',
          className: 'dsss-backdrop',
          role: 'presentation',
          onClick: () => {
            editorStore.close()
          },
        }),
        h(
          'div',
          {
            key: 'card',
            ref: cardRef,
            role: 'dialog',
            'aria-label': t('dialog.title'),
            tabIndex: -1,
            className: `dsss-card dsss-tier-${stars || 1}`,
            style: cardPosition(request.rect),
            onKeyDown: (event) => {
              if (event.metaKey || event.ctrlKey || event.altKey) return
              if (event.key < '1' || event.key > '5') return
              event.preventDefault()
              void select(Number(event.key))
            },
          },
          h(
            'div',
            { className: 'dsss-card__head' },
            h('span', {
              className: 'dsss-card__title',
              title: request.title === '' ? undefined : request.title,
              children: request.title === '' ? t('dialog.title') : request.title,
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsss-card__close',
                title: t('dialog.close'),
                'aria-label': t('dialog.close'),
                onClick: () => {
                  editorStore.close()
                },
              },
              h(CloseGlyph),
            ),
          ),
          h(
            'div',
            { className: 'dsss-card__stars', onMouseLeave: () => setHovered(0) },
            Array.from({ length: MAX_STARS }, (_value, index) => {
              const value = index + 1
              return h(
                'button',
                {
                  key: value,
                  type: 'button',
                  className: value <= active ? 'dsss-starButton is-on' : 'dsss-starButton',
                  'aria-label': t('dialog.star', { stars: String(value), level: t(LEVEL_KEY[value]) }),
                  'aria-pressed': value === stars,
                  onMouseEnter: () => setHovered(value),
                  onClick: () => {
                    void select(value)
                  },
                },
                h(StarGlyph, { size: 26, filled: value <= active }),
              )
            }),
          ),
          h(
            'div',
            { className: 'dsss-card__rating' },
            h('span', { className: 'dsss-card__value', children: stars > 0 ? `${stars} / 5` : '—' }),
            h('span', { className: 'dsss-chip', children: level }),
          ),
          h(
            'div',
            { className: 'dsss-scale', role: 'group', 'aria-label': t('dialog.scale'), onMouseLeave: () => setHovered(0) },
            Array.from({ length: MAX_STARS }, (_value, index) => {
              const value = index + 1
              return h(
                'button',
                {
                  key: value,
                  type: 'button',
                  className: `dsss-scale__item dsss-tier-${value}${value === stars ? ' is-current' : ''}`,
                  'aria-label': t('dialog.star', { stars: String(value), level: t(LEVEL_KEY[value]) }),
                  'aria-pressed': value === stars,
                  onMouseEnter: () => setHovered(value),
                  onClick: () => {
                    void select(value)
                  },
                },
                t(LEVEL_KEY[value]),
              )
            }),
          ),
          h('p', { className: 'dsss-card__hint', children: t('dialog.hint') }),
          h(
            'div',
            { className: 'dsss-card__actions' },
            stars > 0
              ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsss-clear',
                  onClick: () => {
                    void select(0)
                  },
                },
                t('dialog.clear'),
              )
              : null,
            saved ? h('span', { className: 'dsss-saved', role: 'status', children: t('dialog.saved') }) : null,
            failure
              ? h('span', { className: 'dsss-error', role: 'alert', children: t('error.save') })
              : unavailable
                ? h('span', { className: 'dsss-error', role: 'alert', children: t('error.load') })
                : null,
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const CSS = [
      '.dsss-tier-1{--dsss-star:var(--dsw-alias-label-secondary)}',
      '.dsss-tier-2{--dsss-star:var(--dsw-alias-state-success-primary)}',
      '.dsss-tier-3{--dsss-star:var(--dsw-alias-brand-primary)}',
      '.dsss-tier-4{--dsss-star:var(--dsw-alias-state-warn-primary)}',
      '.dsss-tier-5{--dsss-star:var(--dsw-alias-state-error-primary)}',
      '.dsss-gauge{display:inline-flex;align-items:center;gap:1px;line-height:0}',
      '.dsss-gauge__star{display:inline-flex;align-items:center;justify-content:center}',
      '.dsss-gauge__star.is-off{opacity:.3}',
      '.dsss-badge{display:inline-flex;align-items:center;flex:none;margin-left:3px;vertical-align:middle;',
      'color:var(--dsss-star,var(--dsw-alias-label-secondary));border-radius:999px}',
      '.dsss-badge.is-strong{padding:1px 5px 1px 4px;background:color-mix(in srgb, var(--dsss-star) 15%, transparent);',
      'box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsss-star) 32%, transparent)}',
      '.dsss-hover{display:flex;align-items:center;gap:7px;margin-top:4px;',
      'color:var(--dsss-star,var(--dsw-alias-label-secondary));font-size:12px;line-height:18px}',
      '.dsss-chip{display:inline-flex;align-items:center;height:18px;padding:0 7px;box-sizing:border-box;',
      'border-radius:999px;font-size:11.5px;font-weight:500;color:var(--dsss-star);',
      'background:color-mix(in srgb, var(--dsss-star) 16%, transparent);',
      'border:1px solid color-mix(in srgb, var(--dsss-star) 30%, transparent)}',
      '.dsss-actionButton{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;',
      'padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;cursor:pointer;flex:none;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dsss-actionButton:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsss-actionButton.is-rated{color:var(--dsss-star,var(--dsw-alias-brand-primary))}',
      '.dsss-menu-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
      'padding:6px 10px;border:0;background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:13px;line-height:18px;text-align:left;border-radius:var(--dsw-radius-sm,6px);cursor:pointer}',
      '.dsss-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsss-menu-item__icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;',
      'color:var(--dsss-star,var(--dsw-alias-label-secondary))}',
      '.dsss-menu-item__label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsss-menu-item__meta{flex:none;font-size:11px;color:var(--dsss-star,var(--dsw-alias-label-tertiary))}',
      '.dsss-backdrop{position:fixed;inset:0;z-index:9000;background:transparent;pointer-events:auto}',
      '.dsss-card{position:fixed;z-index:9001;box-sizing:border-box;display:flex;flex-direction:column;gap:9px;',
      'padding:13px 13px 12px;pointer-events:auto;background:var(--dsw-alias-bg-overlay);',
      'color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2);',
      'border-top:3px solid var(--dsss-star,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-lg,10px);',
      'box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgba(0,0,0,.28));',
      'font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:18px;outline:none}',
      '.dsss-card__head{display:flex;align-items:center;gap:8px}',
      '.dsss-card__title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.dsss-card__close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;',
      'padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dsss-card__close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsss-card__stars{display:flex;align-items:center;gap:2px}',
      '.dsss-starButton{display:inline-flex;align-items:center;justify-content:center;width:40px;height:36px;',
      'padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dsss-starButton:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsss-starButton.is-on{color:var(--dsw-alias-state-warn-primary)}',
      '.dsss-card__rating{display:flex;align-items:center;gap:8px;min-height:20px}',
      '.dsss-card__value{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;',
      'color:var(--dsss-star,var(--dsw-alias-label-primary))}',
      '.dsss-scale{display:flex;align-items:stretch;gap:4px}',
      '.dsss-scale__item{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;height:26px;',
      'padding:0 2px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;',
      'background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;',
      'white-space:nowrap;cursor:pointer}',
      '.dsss-scale__item:hover{background:color-mix(in srgb, var(--dsss-star) 10%, transparent);',
      'color:var(--dsw-alias-label-primary)}',
      '.dsss-scale__item.is-current{background:color-mix(in srgb, var(--dsss-star) 20%, transparent);',
      'border-color:var(--dsss-star);color:var(--dsss-star);font-weight:600}',
      '.dsss-card__hint{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
      '.dsss-card__actions{display:flex;align-items:center;gap:8px;min-height:24px}',
      '.dsss-clear{padding:4px 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;',
      'color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}',
      '.dsss-clear:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsss-saved{font-size:12px;color:var(--dsw-alias-state-success-primary)}',
      '.dsss-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}',
      '.dsss-actionButton:focus-visible,.dsss-menu-item:focus-visible,.dsss-starButton:focus-visible,',
      '.dsss-scale__item:focus-visible,.dsss-card__close:focus-visible,.dsss-clear:focus-visible',
      '{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    ].join('')

    /* ------------------------------------------------------------------ *
     * Client plugin
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin-css', 'dsh-session-stars/SessionStars.css')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => {
            style.remove()
          }
        }, 'session-stars: styles')

        ctx.effect(
          () => ctx.locale.register(NS, {
            zh: ZH,
            en: EN,
            ja: EN,
            es: EN,
            fr: EN,
            de: EN,
            ru: EN,
            pt: EN,
          }),
          'session-stars: dictionaries',
        )

        ctx.effect(() => {
          const refresh = () => {
            if (document.visibilityState === 'hidden') return
            void ratingsStore.refresh()
          }
          window.addEventListener('focus', refresh)
          document.addEventListener('visibilitychange', refresh)
          void ratingsStore.refresh()
          return () => {
            window.removeEventListener('focus', refresh)
            document.removeEventListener('visibilitychange', refresh)
          }
        }, 'session-stars: rating sync')

        ctx.effect(() => {
          if (typeof EventSource !== 'function') return undefined
          const source = new EventSource(EVENTS)
          const onRatings = (event) => {
            try {
              const payload = JSON.parse(event.data)
              if (payload?.ok === true) ratingsStore.applyServer(payload.ratings)
            } catch {
              /* a malformed push is ignored; the next one or a focus refresh repairs it */
            }
          }
          const onError = () => {
            void ratingsStore.refresh()
          }
          source.addEventListener('ratings', onRatings)
          source.addEventListener('error', onError)
          return () => {
            source.removeEventListener('ratings', onRatings)
            source.removeEventListener('error', onError)
            source.close()
          }
        }, 'session-stars: live sync')

        ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
          name: 'sidebar.session.row.trailing',
          id: 'session-stars',
          order: 100,
          locale: NS,
        }, SessionStarBadge))

        ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
          name: 'sidebar.session.row.hover',
          id: 'session-stars',
          order: 100,
          locale: NS,
        }, SessionStarHover))

        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'session-stars',
          order: 50,
          locale: NS,
        }, SessionStarAction))

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'session-stars-menu',
          order: 110,
          locale: NS,
        }, SessionStarMenuItem))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-stars-dialog',
          order: 60,
          locale: NS,
        }, SessionStarDialog))
      },
    }
  },
})
