/**
 * dsh-session-stars — browser half.
 *
 * Adds a star rating (favorite importance, 1-5) to every session row in the
 * workspace browser:
 *  - a hover action button in `sidebar.workspaces.session.row.action` opens a
 *    compact star picker anchored to the button through `shell.overlay`;
 *  - a non-interactive badge in `sidebar.session.row.trailing` shows the
 *    current importance;
 *  - the session hover card gains a labeled star row.
 *
 * Ratings are durable Host data read and written through the same-origin
 * `/session-stars` JSON route. Visible copy comes from the Client locale
 * service; styling uses only theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-stars',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'session-stars'
    const ENDPOINT = '/session-stars'
    const MAX_STARS = 5
    const CARD_WIDTH = 268
    const CARD_HEIGHT = 206
    const VIEWPORT_MARGIN = 8
    const LEVEL_KEY = ['', 'level.1', 'level.2', 'level.3', 'level.4', 'level.5']

    const EN = {
      'action.unrated': 'Set importance stars',
      'action.rated': 'Importance {stars} of 5: {level}',
      'badge.title': 'Importance {stars} of 5: {level}',
      'dialog.title': 'Favorite importance',
      'dialog.hint': 'Pick 1-5 stars. More stars mark a more important session.',
      'dialog.current': '{stars} of 5 · {level}',
      'dialog.empty': 'Not rated yet',
      'dialog.clear': 'Clear rating',
      'dialog.close': 'Close',
      'dialog.star': '{stars} of 5: {level}',
      'hover.label': 'Importance',
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
      'badge.title': '重要度 {stars}/5：{level}',
      'dialog.title': '收藏重要度',
      'dialog.hint': '选择 1-5 星，星级越高表示这个会话越重要。',
      'dialog.current': '{stars}/5 · {level}',
      'dialog.empty': '尚未评级',
      'dialog.clear': '清除评级',
      'dialog.close': '关闭',
      'dialog.star': '{stars}/5：{level}',
      'hover.label': '重要度',
      'level.1': '低',
      'level.2': '一般',
      'level.3': '重要',
      'level.4': '很重要',
      'level.5': '关键',
      'error.load': '星级暂时不可用',
      'error.save': '星级保存失败',
    }

    /* ------------------------------------------------------------------ *
     * Ratings store (Host-backed, optimistic writes)
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

      function refresh() {
        if (inflight !== null) return inflight
        inflight = (async () => {
          try {
            const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'invalid response')
            publish({ status: 'ready', ratings: normalizeRatings(payload.ratings) })
          } catch (error) {
            report(error)
            publish({ status: state.status === 'ready' ? 'ready' : 'error', ratings: state.ratings })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      async function setRating(sessionId, stars) {
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
        }
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

    function tierOf(stars) {
      if (stars >= 5) return 5
      if (stars === 4) return 4
      if (stars === 3) return 3
      if (stars >= 1) return 2
      return 0
    }

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

    /** Non-interactive importance badge after the row's relative time. */
    function SessionStarBadge({ sessionId, t }) {
      const stars = useStars(sessionId)
      if (stars === 0) return null
      const level = levelText(t, stars)
      const label = t('badge.title', { stars: String(stars), level })
      return h(
        'span',
        { className: `dsss-badge dsss-tier-${tierOf(stars)}`, title: label, 'aria-label': label, role: 'img' },
        h(StarGlyph, { size: 10, filled: true }),
        h('span', { className: 'dsss-badge__count', children: String(stars) }),
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
            ? `dsss-actionButton is-rated dsss-tier-${tierOf(stars)}`
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
            editorStore.open({
              sessionId,
              title: typeof displayTitle === 'string' ? displayTitle : '',
              rect: event.currentTarget.getBoundingClientRect(),
            })
          },
        },
        h(StarGlyph, { size: 14, filled: stars > 0 }),
      )
    }

    /** Section of the session hover card: stars plus the localized level. */
    function SessionStarHover({ sessionId, t }) {
      const stars = useStars(sessionId)
      if (stars === 0) return null
      return h(
        'div',
        { className: `dsss-hover dsss-tier-${tierOf(stars)}` },
        h(
          'span',
          { className: 'dsss-hover__stars', 'aria-hidden': true },
          Array.from({ length: stars }, (_value, index) => h(StarGlyph, { key: index, size: 11, filled: true })),
        ),
        h('span', { className: 'dsss-hover__label', children: `${t('hover.label')}: ${levelText(t, stars)}` }),
      )
    }

    /** The one open star picker, rendered in the frame-wide overlay layer. */
    function SessionStarDialog({ t }) {
      const request = useEditorRequest()
      const state = useRatingsState()
      const [hovered, setHovered] = useState(0)
      const [failure, setFailure] = useState(false)
      const cardRef = useRef(null)

      const sessionId = request === null ? null : request.sessionId
      useEffect(() => {
        if (sessionId === null) return undefined
        setHovered(0)
        setFailure(false)
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

      if (request === null) return null

      const stars = state.ratings[request.sessionId]?.stars ?? 0
      const level = levelText(t, stars)
      const active = hovered > 0 ? hovered : stars
      const unavailable = state.status === 'error'

      const select = async (next) => {
        setFailure(false)
        const result = await ratingsStore.setRating(request.sessionId, next)
        if (!result.ok) setFailure(true)
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
            className: `dsss-card dsss-tier-${tierOf(stars) || 3}`,
            style: cardPosition(request.rect),
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
          h('span', {
            className: 'dsss-card__level',
            children: stars > 0 ? t('dialog.current', { stars: String(stars), level }) : t('dialog.empty'),
          }),
          h(
            'div',
            { className: 'dsss-stars', onMouseLeave: () => setHovered(0) },
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
                h(StarGlyph, { size: 22, filled: value <= active }),
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
      '.dsss-tier-2{--dsss-star:var(--dsw-alias-label-secondary)}',
      '.dsss-tier-3{--dsss-star:var(--dsw-alias-brand-primary)}',
      '.dsss-tier-4{--dsss-star:var(--dsw-alias-state-warn-primary)}',
      '.dsss-tier-5{--dsss-star:var(--dsw-alias-state-error-primary)}',
      '.dsss-badge{display:inline-flex;align-items:center;gap:1px;flex:none;margin-left:2px;',
      'color:var(--dsss-star,var(--dsw-alias-label-secondary));vertical-align:middle}',
      '.dsss-badge__count{font-size:10px;line-height:1;font-weight:600;font-variant-numeric:tabular-nums}',
      '.dsss-hover{display:flex;align-items:center;gap:6px;margin-top:4px;',
      'color:var(--dsss-star,var(--dsw-alias-label-secondary));font-size:12px;line-height:18px}',
      '.dsss-hover__stars{display:inline-flex;align-items:center;gap:1px}',
      '.dsss-hover__label{color:var(--dsw-alias-label-secondary)}',
      '.dsss-actionButton{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;',
      'padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;cursor:pointer;flex:none;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dsss-actionButton:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsss-actionButton.is-rated{color:var(--dsss-star,var(--dsw-alias-brand-primary))}',
      '.dsss-actionButton:focus-visible,.dsss-starButton:focus-visible,.dsss-card__close:focus-visible,',
      '.dsss-clear:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsss-backdrop{position:fixed;inset:0;z-index:9000;background:transparent;pointer-events:auto}',
      '.dsss-card{position:fixed;z-index:9001;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;',
      'padding:12px;pointer-events:auto;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);',
      'box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgba(0,0,0,.28));',
      'font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:18px;outline:none}',
      '.dsss-card__head{display:flex;align-items:center;gap:8px}',
      '.dsss-card__title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.dsss-card__close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;',
      'padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dsss-card__close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsss-card__level{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsss-stars{display:flex;align-items:center;gap:2px}',
      '.dsss-starButton{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;',
      'padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dsss-starButton:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsss-starButton.is-on{color:var(--dsw-alias-state-warn-primary)}',
      '.dsss-card__hint{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
      '.dsss-card__actions{display:flex;align-items:center;gap:8px;min-height:24px}',
      '.dsss-clear{padding:4px 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;',
      'color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}',
      '.dsss-clear:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsss-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}',
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
