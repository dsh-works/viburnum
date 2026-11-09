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
        panel: 'viburnum',
        title: 'viburnum',
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
        back: 'Back',
        version: 'version',
        incoming: 'incoming',
        noIncoming: 'Nothing to pull on this track.',
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
      nameLink: {
        padding: 0,
        border: 'none',
        background: 'none',
        color: 'inherit',
        font: 'inherit',
        fontWeight: 600,
        cursor: 'pointer',
      },
      changelog: {
        whiteSpace: 'pre-wrap',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
        maxHeight: '260px',
        overflow: 'auto',
        background: 'var(--dsw-alias-bg-layer-2)',
        padding: '8px 10px',
        borderRadius: '6px',
        margin: 0,
      },
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
      let state = { snapshot: null, phase: 'loading', error: null, busy: null, last: null, detail: null }
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
        async openDetail(name) {
          set({ detail: { name, phase: 'loading', data: null, error: null } })
          try {
            const data = await request('/viburnum/action', {
              method: 'POST',
              body: JSON.stringify({ action: 'detail', bundle: name }),
            })
            set({ detail: { name, phase: 'ready', data, error: null } })
          } catch (error) {
            set({ detail: { name, phase: 'error', data: null, error: error.message } })
          }
        },
        closeDetail() {
          set({ detail: null })
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

    /** The trimmed blue-butterfly mark (52×46), embedded for the sidebar glyph. */
    const ICON_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAAAuCAYAAABnNToWAAACi0lEQVR4nN2ZsU0EQQxFrwgi6AAhCAgQBZBcRAFkQEQLSDSARExGRAOIDhBVUAARpGSgWcknn8/2fHt3bncZybrTaXfGb/1tz+wtFgOOnd3D32JDzjnaKCCv10f/C6hvhCYZ4axTk45wBmqICDcdEccmDcJHzcnZgNDwnJ0dDA3L6dnCWDY7J8r1L8/f3X37x+cr2ypUWeT27r2zvZPLNSu/oc4QDJkE4t+bw0gQzQjOmqc4q8FIawYkYQ6uHl2j67Ro8eh4ME2hyqQezPLhrQrG50JAUKBUTmtABcIyD2oIIO60JXme0xs3a3LzgCSYlGAGqAYRymeaRMpMGq9cHlQGRhYkNI9VKERyBeLj62dlVqRochQIyV9N6hJsDSoDxKNEi0Wk51VWVOomkCY7D0jCWFHSoOj3Wt5KaUcKUyhK1iLaE1su7zuT5RaB8dTg5a9bHJBK50WJgLghFTUDZFY7WjAKJSWgwXCgWjWtAVVzyIOKJCotQACnZzdrQGi/01pESG5Is7Uc0BKUYLJAkYfnbZY3th9oo5PNrhVQCkYrFLUuLjs3CpTJ014wdJN18LP2VjUgFMrb4cMwltx4H7GMrtGAMns2TQHhM5SVO/Lp8WYppUAwHIhHOyrjcFQ8mIy+PblFJRzOFQ6TbawSygLiEfAkzGWfPqZ70Sn/DHw+XXSfxaJA0aiHGicKJGHIskB9y3Tv/BkbSM45WEHYBhBfg8/fK0peUaDcQWAyQPyBaVDNe5DWyfmisv+MBuRBIZ2cv8nhO4RalWsiOQvKgvO6OAFxQARKSnowoAX48s/ajmiAfc9Y6R1DDQ56v+zMEZFzE5ihB7Lr1o4kY/vtDkTO5gv5qQ9LzhmQP3F7cAq8ElTbAAAAAElFTkSuQmCC'
    const ICON_ASPECT = 52 / 46

    /**
     * The sidebar glyph: the trimmed mark, centred on the panel-icon axis, then
     * the label and the status dot. The shell's own label is hidden on this row
     * only and re-rendered here so the dot can follow the text.
     */
    function viburnumIcon(props) {
      const state = useStore(props.store)
      const size = typeof props.size === 'number' ? props.size : 18
      const dot = state.snapshot ? state.snapshot.dot : 'grey'
      const active = props.active === true
      const expanded = size <= 16
      const height = size + 10
      const width = Math.round(height * ICON_ASPECT)
      const extra = width - size
      const half = extra / 2
      const vertical = Math.round((height - size) / 2)
      const label = props.locale.bind(NS)('panel')

      return h(
        'span',
        {
          style: {
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            flex: '0 0 auto',
          },
        },
        h('img', {
          src: ICON_DATA,
          alt: '',
          width,
          height,
          draggable: false,
          style: {
            display: 'block',
            margin: `${-vertical}px -${half}px ${-vertical}px -${half}px`,
            opacity: active ? 1 : 0.82,
          },
        }),
        expanded
          ? h('style', { key: 'hide-label' }, `button[aria-label=${JSON.stringify(label)}] > span:last-child{display:none}`)
          : null,
        expanded
          ? h('span', { key: 'label', style: { whiteSpace: 'nowrap', position: 'relative', top: '1px', marginLeft: '4px' } }, label)
          : null,
        h('span', {
          'aria-hidden': 'true',
          style: {
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            flex: '0 0 auto',
            position: 'relative',
            top: '2px',
            background: DOT_TOKEN[dot] || DOT_TOKEN.grey,
          },
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
    function viburnumPage(props) {
      const store = props.store
      const t = props.locale.bind(NS)
      const state = useStore(store)
      const snapshot = state.snapshot || { rows: [], dot: 'grey', checkedAt: null }
      const rows = snapshot.rows || []
      const pullable = rows.filter((row) => row.status === 'remote-ahead').length
      const busy = state.busy !== null
      const banner = state.last ? describeResult(state.last, t) : null
      const detail = state.detail

      const run = (action, payload) => {
        void store.act(action, payload)
      }
      const openDetail = (name) => {
        void store.openDetail(name)
      }
      const runDetail = (action, payload) => {
        void store.act(action, payload).then(() => {
          if (detail !== null) void store.openDetail(detail.name)
        })
      }

      const rowView = (row) =>
        h(
          'div',
          { key: row.name, style: styles.row },
          h(
            'div',
            { style: styles.rowTop },
            h('span', { style: { ...styles.dot, background: DOT_TOKEN[row.dot] || DOT_TOKEN.grey } }),
            h('button', { style: styles.nameLink, onClick: () => openDetail(row.name) }, row.name),
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

      const detailView = () => {
        const data = detail.data
        const back = h('button', { style: styles.button, onClick: () => store.closeDetail() }, '← ' + t('back'))
        if (detail.phase === 'loading' && data === null) {
          return h(
            'div',
            { style: styles.page },
            h('div', { style: styles.header }, back),
            h('div', { style: styles.empty }, t('loading')),
          )
        }
        if (detail.phase === 'error' || data === null || data.ok === false) {
          return h(
            'div',
            { style: styles.page },
            h('div', { style: styles.header }, back),
            h('div', { style: styles.error }, (data && data.message) || detail.error || t('transportError')),
          )
        }

        const bundle = data.bundle
        const incoming = data.incoming
        return h(
          'div',
          { style: styles.page },
          h(
            'div',
            { style: styles.header },
            back,
            h('span', { style: styles.title }, bundle.name),
            h('span', { style: styles.subtitle }, (bundle.version ? 'v' + bundle.version + ' · ' : '') + (bundle.track || '-')),
            h('span', { style: styles.spacer }),
            h('button', { style: styles.button, disabled: busy, onClick: () => runDetail('update', { bundle: bundle.name }) }, t('update')),
            h('button', { style: styles.button, disabled: busy, onClick: () => runDetail('sync', { bundle: bundle.name }) }, t('sync')),
            h('button', { style: styles.button, disabled: busy, onClick: () => runDetail('revert', { bundle: bundle.name }) }, t('revert')),
          ),
          h('div', { style: styles.secondary }, bundle.dir),
          h(
            'div',
            { style: styles.controls },
            h('span', { style: styles.secondary }, t('switchTo')),
            h(
              'select',
              {
                style: styles.select,
                value: bundle.track || '',
                disabled: busy,
                onChange: (event) => runDetail('switch', { bundle: bundle.name, track: event.target.value }),
              },
              data.branches.map((track) => h('option', { key: track, value: track }, track)),
            ),
          ),
          banner !== null && banner !== '' ? h('div', { style: styles.banner }, banner) : null,
          h(
            'div',
            { style: styles.row },
            h(
              'div',
              { style: styles.rowTop },
              h('span', { style: { ...styles.dot, background: DOT_TOKEN[bundle.dot] || DOT_TOKEN.grey } }),
              h('span', { style: styles.status }, '↓' + (incoming ? incoming.behind : 0) + ' ' + t('incoming')),
              incoming && incoming.nextVersion ? h('span', { style: styles.arrows }, 'next ' + incoming.nextVersion) : null,
            ),
            h('pre', { style: styles.changelog }, incoming && incoming.changelog ? incoming.changelog : t('noIncoming')),
            incoming && incoming.reloadLabel ? h('div', { style: styles.secondary }, incoming.reloadLabel) : null,
          ),
        )
      }

      if (detail !== null) return detailView()

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
            inject: () => ({ store, locale: ctx.locale }),
          },
          viburnumIcon,
        ))

        ctx.slots.inject('main', () => ctx.slots.register(
          {
            name: 'main',
            key: 'viburnum',
            locale: NS,
            inject: () => ({ store, locale: ctx.locale }),
          },
          viburnumPage,
        ))
      },
    }
  },
})
