/**
 * Browser half of the viburnum bundle.
 *
 * One sidebar row carries the aggregate dot; the page behind it lists the linked
 * checkouts and their quick actions. Data comes from the Host half's
 * `/viburnum` routes, which are the only transport an out-of-tree bundle has.
 *
 * This file is a classic script: no import, no export, no top-level await. It
 * registers through the module loader and uses no Harness Client package.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-viburnum',
  factory(require) {
    const React = require('react')
    const NS = 'dsh-viburnum'
    const h = React.createElement

    /** Semantic colour tokens per aggregate dot. */
    const DOT_TOKEN = {
      green: 'var(--dsw-alias-state-success-primary)',
      violet: 'var(--dsw-alias-brand-primary)',
      orange: 'var(--dsw-alias-state-warn-primary)',
      red: 'var(--dsw-alias-state-error-primary)',
      grey: 'var(--dsw-alias-state-idle-primary)',
    }

    /** UI copy; every visible string comes from the locale service. */
    const DICT = {
      en: {
        panel: 'Viburnum',
        title: 'Viburnum',
        mounted: 'mounted',
        pullable: 'pullable',
        refresh: 'Refresh',
        syncAll: 'Sync all',
        update: 'Update',
        sync: 'Sync',
        revert: 'Revert',
        switchTo: 'track',
        loading: 'Checking…',
        transportError: 'The Host did not answer.',
        stale: 'stale',
        refused: 'refused',
        pushed: 'pushed',
        pulled: 'pulled',
        rebased: 'rebased',
        on: 'on',
        noBundles: 'No linked bundles.',
        dryRun: 'plan',
        'status.current': 'current',
        'status.remote-ahead': 'pullable',
        'status.local-ahead': 'unpushed',
        'status.diverged': 'diverged',
        'status.dirty': 'uncommitted',
        'status.detached': 'detached',
        'status.rebasing': 'rebase in progress',
        'status.local-only': 'local only',
        'status.missing': 'missing',
        'status.unknown': 'unknown',
      },
      zh: {
        panel: 'Viburnum',
        title: 'Viburnum',
        mounted: '已挂载',
        pullable: '可拉取',
        refresh: '刷新',
        syncAll: '全部同步',
        update: '更新',
        sync: '同步',
        revert: '还原',
        switchTo: '跟踪分支',
        loading: '检查中…',
        transportError: 'Host 没有响应。',
        stale: '已过期',
        refused: '拒绝',
        pushed: '已推送',
        pulled: '已拉取',
        rebased: '已变基',
        on: '位于',
        noBundles: '没有已链接的插件。',
        dryRun: '计划',
        'status.current': '最新',
        'status.remote-ahead': '可拉取',
        'status.local-ahead': '未推送',
        'status.diverged': '已分叉',
        'status.dirty': '未提交',
        'status.detached': '游离 HEAD',
        'status.rebasing': '变基进行中',
        'status.local-only': '仅本地',
        'status.missing': '目录缺失',
        'status.unknown': '未知',
      },
    }

    /** Shared inline styles; colour always comes from a theme token. */
    const styles = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
        boxSizing: 'border-box',
        padding: '18px 22px',
        overflow: 'auto',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        lineHeight: '1.45',
      },
      header: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      title: { fontSize: '18px', fontWeight: 600, marginRight: '8px' },
      subtitle: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      spacer: { flex: 1 },
      button: {
        padding: '4px 10px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
        cursor: 'pointer',
      },
      row: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '10px 12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      rowTop: { display: 'flex', alignItems: 'center', gap: '8px' },
      dot: { width: '8px', height: '8px', borderRadius: '50%', flex: '0 0 auto' },
      name: { fontWeight: 600 },
      track: {
        padding: '0 6px',
        borderRadius: '4px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
      },
      arrows: { color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      status: { color: 'var(--dsw-alias-label-secondary)' },
      secondary: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', overflowWrap: 'anywhere' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' },
      controls: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      select: {
        padding: '2px 6px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
      },
      banner: {
        padding: '6px 10px',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
      },
      empty: { color: 'var(--dsw-alias-label-secondary)', padding: '12px 0' },
    }

    /** `↑2 ↓3`, or `✓`. */
    function arrows(row) {
      const parts = []
      if ((row.ahead || 0) > 0) parts.push('↑' + row.ahead)
      if ((row.behind || 0) > 0) parts.push('↓' + row.behind)
      return parts.join(' ') || '✓'
    }

    /** The branch chips offered for one row: main, dev and whatever it follows. */
    function trackOptions(row) {
      const names = ['main', 'dev', row.track].filter((name) => typeof name === 'string' && name !== '')
      return names.filter((name, index) => names.indexOf(name) === index)
    }

    /** One client-local store: the status snapshot, the busy state and the last result. */
    function createStore() {
      let state = { snapshot: null, phase: 'loading', error: null, busy: null, last: null }
      const listeners = new Set()

      const emit = () => {
        for (const listener of listeners) listener()
      }
      const set = (patch) => {
        state = { ...state, ...patch }
        emit()
      }

      const request = async (path, init) => {
        const headers = { 'x-viburnum': '1', 'x-viburnum-client': '1' }
        if (init && init.body !== undefined) headers['content-type'] = 'application/json'
        const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      }

      const store = {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        async refresh() {
          set({ phase: state.snapshot === null ? 'loading' : 'refreshing' })
          try {
            const snapshot = await request('/viburnum/status')
            set({ snapshot, phase: 'ready', error: null })
          } catch (error) {
            set({ phase: 'error', error: error.message })
          }
        },
        async act(action, payload) {
          set({ busy: action, last: null })
          try {
            const result = await request('/viburnum/action', {
              method: 'POST',
              body: JSON.stringify({ action, ...(payload || {}) }),
            })
            set({ last: result })
            await store.refresh()
            return result
          } catch (error) {
            const failure = { ok: false, code: 'transport', message: error.message }
            set({ last: failure })
            return failure
          } finally {
            set({ busy: null })
          }
        },
      }
      return store
    }

    /** Subscribe one component to the store. */
    function useStore(store) {
      const [state, setState] = React.useState(store.getSnapshot)
      React.useEffect(() => store.subscribe(() => setState(store.getSnapshot())), [store])
      return state
    }

    /** The sidebar glyph: artwork, with the aggregate dot in the top-right corner. */
    function ViburnumIcon(props) {
      const state = useStore(props.store)
      const size = typeof props.size === 'number' ? props.size : 20
      const dot = state.snapshot ? state.snapshot.dot : 'grey'
      const active = props.active === true

      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          role: 'presentation',
          style: { display: 'block', opacity: active ? 1 : 0.82 },
        },
        h('path', {
          d: 'M11 6C8.4 2.4 3.4 3.2 2.4 7.2c-1 4 2.8 6 5.8 5.8-2.9 1.1-4.6 3.9-3.5 5.8 1.1 2.2 4.6 1.7 6.3-1.2z',
          fill: '#2c6499',
          stroke: '#1b3763',
          strokeWidth: 1,
        }),
        h('path', {
          d: 'M13 6c2.6-3.6 7.6-2.8 8.6 1.2 1 4-2.8 6-5.8 5.8 2.9 1.1 4.6 3.9 3.5 5.8-1.1 2.2-4.6 1.7-6.3-1.2z',
          fill: '#4a8fc4',
          stroke: '#1b3763',
          strokeWidth: 1,
        }),
        h('rect', { x: 11, y: 5, width: 2, height: 14, rx: 1, fill: '#1b3763' }),
        h('circle', {
          cx: 19,
          cy: 5,
          r: 3,
          fill: DOT_TOKEN[dot] || DOT_TOKEN.grey,
          stroke: 'var(--dsw-specific-sidebar-fill)',
          strokeWidth: 1.5,
        }),
      )
    }

    /** One result, in the user's words. */
    function describeResult(result, t) {
      if (result === null || typeof result !== 'object') return ''
      if (Array.isArray(result.results)) {
        const lines = result.results.map((entry) => describeResult(entry, t))
        if (result.totals) {
          lines.push(
            t('pushed') + ' ' + result.totals.pushed + ' · ' + t('pulled') + ' ' + result.totals.pulled + ' · ' + t('rebased') + ' ' + result.totals.rebased,
          )
        }
        return lines.join(' · ')
      }
      if (result.dryRun === true) {
        const plan = result.plan || {}
        return t('dryRun') + ': ' + plan.action
      }
      if (result.ok === false) return t('refused') + ': ' + (result.code || 'error')
      if (result.nothing === true) return (result.bundle || '') + ' ✓'
      const receipt = result.receipt
      if (receipt) {
        const parts = [t('pushed') + ' ' + receipt.pushed, t('pulled') + ' ' + receipt.pulled, t('rebased') + ' ' + receipt.rebased]
        if (receipt.kind === 'switch' && receipt.track) parts.unshift(t('on') + ' ' + receipt.track)
        return parts.join(' · ')
      }
      return ''
    }

    /** The full main-area page. */
    function ViburnumPage(props) {
      const store = props.store
      const t = props.locale.bind(NS)
      const state = useStore(store)
      const snapshot = state.snapshot || { rows: [], dot: 'grey', checkedAt: null }
      const rows = snapshot.rows || []
      const pullable = rows.filter((row) => row.status === 'remote-ahead').length
      const busy = state.busy !== null
      const banner = state.last ? describeResult(state.last, t) : null

      const run = (action, payload) => {
        void store.act(action, payload)
      }

      const rowView = (row) =>
        h(
          'div',
          { key: row.name, style: styles.row },
          h(
            'div',
            { style: styles.rowTop },
            h('span', { style: { ...styles.dot, background: DOT_TOKEN[row.dot] || DOT_TOKEN.grey } }),
            h('span', { style: styles.name }, row.name),
            h('span', { style: styles.track }, row.track || '-'),
            h('span', { style: styles.arrows }, arrows(row)),
            h('span', { style: styles.status }, t('status.' + row.status)),
            row.stale ? h('span', { style: styles.secondary }, '· ' + t('stale')) : null,
            h('span', { style: styles.spacer }),
            h('button', { style: styles.button, disabled: busy, onClick: () => run('update', { bundle: row.name }) }, t('update')),
            h('button', { style: styles.button, disabled: busy, onClick: () => run('sync', { bundle: row.name }) }, t('sync')),
            h('button', { style: styles.button, disabled: busy, onClick: () => run('revert', { bundle: row.name }) }, t('revert')),
          ),
          h('div', { style: styles.secondary }, row.dir),
          h(
            'div',
            { style: styles.controls },
            h('span', { style: styles.secondary }, t('switchTo')),
            h(
              'select',
              {
                style: styles.select,
                value: row.track || '',
                disabled: busy,
                onChange: (event) => run('switch', { bundle: row.name, track: event.target.value }),
              },
              trackOptions(row).map((track) => h('option', { key: track, value: track }, track)),
            ),
            row.error ? h('span', { style: styles.error }, row.error) : null,
          ),
        )

      return h(
        'div',
        { style: styles.page },
        h(
          'div',
          { style: styles.header },
          h('span', { style: styles.title }, t('title')),
          h('span', { style: styles.subtitle }, rows.length + ' ' + t('mounted') + ' · ' + pullable + ' ' + t('pullable')),
          h('span', { style: styles.spacer }),
          h('button', { style: styles.button, disabled: busy, onClick: () => run('refresh') }, t('refresh')),
          h('button', { style: styles.button, disabled: busy, onClick: () => run('sync') }, t('syncAll')),
        ),
        banner !== null && banner !== '' ? h('div', { style: styles.banner }, banner) : null,
        state.phase === 'error' ? h('div', { style: styles.error }, t('transportError')) : null,
        state.phase === 'loading' ? h('div', { style: styles.empty }, t('loading')) : null,
        rows.length === 0 && state.phase === 'ready' ? h('div', { style: styles.empty }, t('noBundles')) : null,
        rows.map(rowView),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'viburnum: locale')

        const store = createStore()
        ctx.effect(() => {
          void store.refresh()
          const timer = setInterval(() => {
            void store.refresh()
          }, 30_000)
          return () => clearInterval(timer)
        }, 'viburnum: status poll')

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'viburnum',
            order: -10,
            locale: NS,
            label: () => ctx.locale.bind(NS)('panel'),
            inject: () => ({ store }),
          },
          ViburnumIcon,
        ))

        ctx.slots.inject('main', () => ctx.slots.register(
          {
            name: 'main',
            key: 'viburnum',
            locale: NS,
            inject: () => ({ store, locale: ctx.locale }),
          },
          ViburnumPage,
        ))
      },
    }
  },
})
