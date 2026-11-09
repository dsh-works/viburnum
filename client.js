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
        opens: 'open',
        folder: 'Folder',
        readme: 'README',
        changelog: 'CHANGELOG',
        opened: 'opened',
        install: 'Install',
        browse: 'Browse…',
        selected: 'selected',
        installed: 'installed',
        cloned: 'cloned',
        directory: 'Directory',
        repository: 'Repository URL',
        organisation: 'Organisation',
        refreshCatalog: 'Refresh catalog',
        catalogEmpty: 'No repositories to show.',
        directoryPlaceholder: 'C:\\path\\to\\plugin',
        repositoryPlaceholder: 'owner/repo or https://github.com/owner/repo',
        installDirectoryHint: 'Link a checkout that already exists where it is.',
        installRepositoryHint: 'Clone into the shelf and link the fresh checkout.',
        installOrganisationHint: 'Pick a repository of a configured owner; it clones into the shelf like the repository door.',
        hygiene: 'Hygiene',
        timeline: 'timeline',
        noHygieneFindings: 'No hygiene problems found.',
        scan: 'Scan',
        settingsTitle: 'viburnum settings',
        settingsHint: 'How often viburnum checks, and whether it warns when the harness drifts.',
        refreshInterval: 'Refresh interval (minutes)',
        refreshOnStartup: 'Refresh on startup',
        versionWarnings: 'Warn about harness version drift',
        shelfDir: 'Plugin checkout directory',
        shelfDirHint: 'Where repository installs clone; checkouts that are already linked stay where they are.',
        useDefault: 'Use default',
        save: 'Save',
        saved: 'saved',
        harnessCompat: 'Harness compatibility',
        runningHarness: 'Running harness',
        noVersionWarnings: 'Every mounted plugin accepts the running harness.',
        close: 'Close',
        truncated: 'truncated',
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
      version: {
        padding: '0 5px',
        borderRadius: '4px',
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        fontVariantNumeric: 'tabular-nums',
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
      input: {
        flex: '1 1 360px',
        minWidth: '220px',
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px',
      },
      banner: {
        padding: '6px 10px',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
      },
      empty: { color: 'var(--dsw-alias-label-secondary)', padding: '12px 0' },
      documentScroll: { maxHeight: '420px', overflow: 'auto', paddingRight: '4px' },
      rowIcon: { width: '20px', height: '20px', objectFit: 'contain', flex: '0 0 auto', borderRadius: '4px' },
      settingsPage: { display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '760px', padding: '16px' },
      markdown: { display: 'flex', flexDirection: 'column', gap: '2px', color: 'var(--dsw-alias-label-primary)' },
      mdP: { margin: '4px 0', lineHeight: '1.55' },
      mdH1: { fontSize: '18px', margin: '10px 0 4px' },
      mdH2: { fontSize: '16px', margin: '10px 0 4px' },
      mdH3: { fontSize: '14px', margin: '8px 0 3px' },
      mdH4: { fontSize: '13px', margin: '8px 0 3px' },
      mdH5: { fontSize: '13px', margin: '8px 0 3px' },
      mdH6: { fontSize: '13px', margin: '8px 0 3px' },
      mdList: { margin: '4px 0', paddingLeft: '20px' },
      mdItem: { margin: '2px 0', lineHeight: '1.5' },
      mdPre: {
        background: 'var(--dsw-alias-bg-layer-2)',
        padding: '8px 10px',
        borderRadius: '6px',
        overflow: 'auto',
        fontSize: '12px',
        maxHeight: '260px',
        margin: '6px 0',
      },
      inlineCode: {
        background: 'var(--dsw-alias-bg-layer-2)',
        padding: '1px 4px',
        borderRadius: '4px',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: '12px',
      },
      link: { color: 'var(--dsw-alias-brand-primary)' },
      mdQuote: {
        margin: '4px 0',
        paddingLeft: '10px',
        borderLeft: '2px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      mdHr: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1)', margin: '8px 0' },
      mdTable: { borderCollapse: 'collapse', margin: '6px 0', fontSize: '12px' },
      mdTh: { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2)' },
      mdTd: { padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l1)', verticalAlign: 'top' },
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

    /** Inline markdown spans as React nodes; text stays escaped by React. */
    function renderInline(text) {
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/u
      const parts = []
      let rest = String(text ?? '')
      let key = 0

      while (rest.length > 0) {
        const match = pattern.exec(rest)
        if (match === null) {
          parts.push(rest)
          break
        }
        if (match.index > 0) parts.push(rest.slice(0, match.index))
        const token = match[0]
        if (token.startsWith('**')) parts.push(h('strong', { key: key++ }, token.slice(2, -2)))
        else if (token.startsWith('`')) {
          parts.push(h('code', { key: key++, style: styles.inlineCode }, token.slice(1, -1)))
        } else if (token.startsWith('*')) parts.push(h('em', { key: key++ }, token.slice(1, -1)))
        else {
          const link = /^\[([^\]]+)\]\(([^)]+)\)/u.exec(token)
          if (link !== null && /^(https?:|mailto:)/u.test(link[2])) {
            parts.push(h('a', {
              key: key++,
              href: link[2],
              target: '_blank',
              rel: 'noreferrer noopener',
              style: styles.link,
            }, link[1]))
          } else {
            parts.push(link !== null ? link[1] : token)
          }
        }
        rest = rest.slice(match.index + token.length)
      }
      return parts
    }

    /** A small, safe markdown renderer: headings, lists, tables, quotes, code. */
    function renderMarkdown(text) {
      const lines = String(text ?? '').split(/\r?\n/u)
      const blocks = []
      let index = 0
      let key = 0

      while (index < lines.length) {
        const line = lines[index]
        if (line.trim() === '') {
          index += 1
          continue
        }

        if (/^```/u.test(line)) {
          const body = []
          index += 1
          while (index < lines.length && !/^```/u.test(lines[index])) {
            body.push(lines[index])
            index += 1
          }
          index += 1
          blocks.push(h('pre', { key: key++, style: styles.mdPre }, h('code', null, body.join('\n'))))
          continue
        }

        const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
        if (heading !== null) {
          const level = heading[1].length
          blocks.push(h(`h${level}`, { key: key++, style: styles[`mdH${level}`] }, renderInline(heading[2])))
          index += 1
          continue
        }

        if (/^\s*([-*_])\1{2,}\s*$/u.test(line)) {
          blocks.push(h('hr', { key: key++, style: styles.mdHr }))
          index += 1
          continue
        }

        if (/^>\s?/u.test(line)) {
          const quote = []
          while (index < lines.length && /^>\s?/u.test(lines[index])) {
            quote.push(lines[index].replace(/^>\s?/u, ''))
            index += 1
          }
          blocks.push(h('blockquote', { key: key++, style: styles.mdQuote }, renderMarkdown(quote.join('\n'))))
          continue
        }

        if (/^\s*[-*+]\s+/u.test(line)) {
          const items = []
          while (index < lines.length && /^\s*[-*+]\s+/u.test(lines[index])) {
            items.push(lines[index].replace(/^\s*[-*+]\s+/u, ''))
            index += 1
          }
          blocks.push(h('ul', { key: key++, style: styles.mdList },
            items.map((item, itemIndex) => h('li', { key: itemIndex, style: styles.mdItem }, renderInline(item)))))
          continue
        }

        if (/^\s*\d+\.\s+/u.test(line)) {
          const items = []
          while (index < lines.length && /^\s*\d+\.\s+/u.test(lines[index])) {
            items.push(lines[index].replace(/^\s*\d+\.\s+/u, ''))
            index += 1
          }
          blocks.push(h('ol', { key: key++, style: styles.mdList },
            items.map((item, itemIndex) => h('li', { key: itemIndex, style: styles.mdItem }, renderInline(item)))))
          continue
        }

        if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/u.test(lines[index + 1])) {
          const parseRow = (row) => row.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim())
          const head = parseRow(line)
          index += 2
          const rows = []
          while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
            rows.push(parseRow(lines[index]))
            index += 1
          }
          blocks.push(h('table', { key: key++, style: styles.mdTable },
            h('thead', null, h('tr', null, head.map((cell, cellIndex) =>
              h('th', { key: cellIndex, style: styles.mdTh }, renderInline(cell))))),
            h('tbody', null, rows.map((row, rowIndex) =>
              h('tr', { key: rowIndex }, row.map((cell, cellIndex) =>
                h('td', { key: cellIndex, style: styles.mdTd }, renderInline(cell))))))))
          continue
        }

        const paragraph = []
        while (index < lines.length && lines[index].trim() !== ''
          && !/^(#{1,6}\s|```|>|\s*[-*+]\s+|\s*\d+\.\s+)/u.test(lines[index])) {
          paragraph.push(lines[index])
          index += 1
        }
        blocks.push(h('p', { key: key++, style: styles.mdP }, renderInline(paragraph.join(' '))))
      }
      return blocks
    }

    /** One client-local store: the status snapshot, the busy state and the last result. */
    function createStore() {
      let state = { snapshot: null, phase: 'loading', error: null, busy: null, last: null, detail: null, doc: null, catalog: null, timeline: null, hygiene: null }
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
            void store.loadTimeline()
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
          set({ detail: { name, phase: 'loading', data: null, error: null }, doc: null })
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
          set({ detail: null, doc: null })
        },
        async saveSettings(patch) {
          set({ busy: 'settings', last: null })
          try {
            const result = await request('/viburnum/action', {
              method: 'POST',
              body: JSON.stringify({ action: 'settings', patch }),
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
        async loadTimeline() {
          try {
            const data = await request('/viburnum/action', {
              method: 'POST',
              body: JSON.stringify({ action: 'timeline' }),
            })
            set({ timeline: { phase: 'ready', events: Array.isArray(data.events) ? data.events : [], error: data.ok === false ? data.message : null } })
          } catch (error) {
            set({ timeline: { phase: 'error', events: [], error: error.message } })
          }
        },
        async loadHygiene(refresh = false) {
          set({ hygiene: { phase: 'loading', findings: [], checkouts: [], roots: [], error: null } })
          try {
            const data = await request('/viburnum/action', {
              method: 'POST',
              body: JSON.stringify({ action: 'hygiene', refresh }),
            })
            set({
              hygiene: {
                phase: 'ready',
                findings: Array.isArray(data.findings) ? data.findings : [],
                checkouts: Array.isArray(data.checkouts) ? data.checkouts : [],
                roots: Array.isArray(data.roots) ? data.roots : [],
                error: data.ok === false ? data.message : null,
              },
            })
          } catch (error) {
            set({ hygiene: { phase: 'error', findings: [], checkouts: [], roots: [], error: error.message } })
          }
        },
        async loadCatalog(refresh = false) {
          set({ catalog: { phase: 'loading', owners: [], error: null } })
          try {
            const data = await request('/viburnum/action', {
              method: 'POST',
              body: JSON.stringify({ action: 'catalog', refresh }),
            })
            set({
              catalog: {
                phase: 'ready',
                owners: Array.isArray(data.owners) ? data.owners : [],
                error: data.ok === false ? data.message : null,
              },
            })
          } catch (error) {
            set({ catalog: { phase: 'error', owners: [], error: error.message } })
          }
        },
        async openDocument(bundle, target) {
          set({ doc: { name: bundle, target, phase: 'loading', text: null, error: null, truncated: false } })
          try {
            const data = await request('/viburnum/action', {
              method: 'POST',
              body: JSON.stringify({ action: 'document', bundle, target }),
            })
            set({
              doc: {
                name: bundle,
                target,
                phase: 'ready',
                text: data.ok === false ? null : data.text,
                error: data.ok === false ? data.message : null,
                truncated: data.truncated === true,
              },
            })
          } catch (error) {
            set({ doc: { name: bundle, target, phase: 'error', text: null, error: error.message, truncated: false } })
          }
        },
        closeDocument() {
          set({ doc: null })
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
      const rows = state.snapshot ? (state.snapshot.rows || []) : []
      const ahead = rows.reduce((sum, row) => sum + (row.ahead || 0), 0)
      const behind = rows.reduce((sum, row) => sum + (row.behind || 0), 0)
      const arrows = [ahead > 0 ? '↑' + ahead : null, behind > 0 ? '↓' + behind : null].filter(Boolean).join(' ')

      return h(
        'span',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flex: '1 1 auto',
            width: '100%',
            minWidth: 0,
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
          ? h('style', { key: 'hide-label' }, `button[aria-label=${JSON.stringify(label)}] > span:last-child{display:none}button[aria-label=${JSON.stringify(label)}] > span:first-child{flex:1 1 auto;min-width:0;justify-content:flex-start}`)
          : null,
        expanded
          ? h('span', { key: 'label', style: { whiteSpace: 'nowrap', position: 'relative', top: '3px', marginLeft: '4px' } }, label)
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
        expanded && arrows !== ''
          ? h('span', {
            key: 'arrows',
            style: {
              marginLeft: 'auto',
              paddingLeft: '8px',
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: '11px',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            },
          }, arrows)
          : null,
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
      if (result.saved === true) return t('saved')
      if (result.installed === true) {
        return t('installed') + ' ' + (result.name || '') + (result.version ? ' v' + result.version : '')
          + (result.cloned === true ? ' · ' + t('cloned') : '')
      }
      if (result.ok === true && typeof result.path === 'string') return t('selected') + ' ' + result.path
      if (result.opened === true) return t('opened') + ' ' + (result.target || '')
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
      const doc = state.doc
      const timeline = state.timeline
      const hygiene = state.hygiene
      const [hygieneOpen, setHygieneOpen] = React.useState(false)
      React.useEffect(() => {
        void store.loadTimeline()
      }, [])
      const [installOpen, setInstallOpen] = React.useState(false)
      const [installDoor, setInstallDoor] = React.useState('directory')
      const [installSpec, setInstallSpec] = React.useState('')
      const catalogOwners = Array.isArray(snapshot.config?.catalogOwners) ? snapshot.config.catalogOwners : []
      const [catalogOwner, setCatalogOwner] = React.useState('')
      const [catalogRepo, setCatalogRepo] = React.useState('')
      const catalog = state.catalog
      const ownerEntry = catalog !== null && Array.isArray(catalog.owners)
        ? (catalog.owners.find((entry) => entry.owner === (catalogOwner || catalogOwners[0])) ?? null)
        : null
      const catalogRepos = ownerEntry !== null && Array.isArray(ownerEntry.repos) ? ownerEntry.repos : []
      React.useEffect(() => {
        if (catalogOwner === '' && catalogOwners.length > 0) setCatalogOwner(catalogOwners[0])
      }, [catalogOwners, catalogOwner])
      React.useEffect(() => {
        if (installOpen && installDoor === 'organisation' && catalog === null) void store.loadCatalog(false)
      }, [installOpen, installDoor, catalog])

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
          {
            key: row.name,
            style: { ...styles.row, cursor: 'pointer' },
            onClick: () => openDetail(row.name),
          },
          h(
            'div',
            { style: styles.rowTop },
            h('span', { style: { ...styles.dot, background: DOT_TOKEN[row.dot] || DOT_TOKEN.grey } }),
            row.icon ? h('img', { key: 'icon', src: row.icon, alt: '', width: 20, height: 20, style: styles.rowIcon }) : null,
            h('button', {
              style: styles.nameLink,
              onClick: (event) => {
                event.stopPropagation()
                openDetail(row.name)
              },
            }, row.name),
            row.version ? h('span', { style: styles.version }, 'v' + row.version) : null,
            h('span', { style: styles.track }, row.track || '-'),
            h('span', { style: styles.arrows }, arrows(row)),
            h('span', { style: styles.status }, t('status.' + row.status)),
            row.stale ? h('span', { style: styles.secondary }, '· ' + t('stale')) : null,
            h('span', { style: styles.spacer }),
            h('button', {
              style: styles.button,
              disabled: busy,
              onClick: (event) => {
                event.stopPropagation()
                run('update', { bundle: row.name })
              },
            }, t('update')),
            h('button', {
              style: styles.button,
              disabled: busy,
              onClick: (event) => {
                event.stopPropagation()
                run('sync', { bundle: row.name })
              },
            }, t('sync')),
            h('button', {
              style: styles.button,
              disabled: busy,
              onClick: (event) => {
                event.stopPropagation()
                run('revert', { bundle: row.name })
              },
            }, t('revert')),
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
                onClick: (event) => event.stopPropagation(),
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
          h(
            'div',
            { style: styles.controls },
            h('span', { style: styles.secondary }, t('opens')),
            h('button', { style: styles.button, onClick: () => void store.openDocument(bundle.name, 'readme') }, t('readme')),
            h('button', { style: styles.button, onClick: () => void store.openDocument(bundle.name, 'changelog') }, t('changelog')),
            h('button', { style: styles.button, onClick: () => runDetail('open', { bundle: bundle.name, target: 'folder' }) }, t('folder')),
          ),
          doc !== null
            ? h(
              'div',
              { style: styles.row },
              h(
                'div',
                { style: styles.rowTop },
                h('span', { style: styles.status }, doc.name + ' · ' + doc.target),
                h('span', { style: styles.spacer }),
                h('button', { style: styles.button, onClick: () => store.closeDocument() }, t('close')),
              ),
              doc.phase === 'loading' ? h('div', { style: styles.empty }, t('loading')) : null,
              doc.error ? h('div', { style: styles.error }, doc.error) : null,
              doc.text
                ? h('div', { style: styles.documentScroll },
                  h('div', { style: styles.markdown }, renderMarkdown(doc.text)))
                : null,
              doc.truncated ? h('div', { style: styles.secondary }, t('truncated')) : null,
            )
            : null,
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
            h('div', { style: styles.documentScroll },
              h('div', { style: styles.markdown },
                incoming && incoming.changelog
                  ? renderMarkdown(incoming.changelog)
                  : h('div', { style: styles.secondary }, t('noIncoming')))),
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
          snapshot.version ? h('span', { style: styles.version }, 'v' + snapshot.version) : null,
          h('span', { style: styles.subtitle }, rows.length + ' ' + t('mounted') + ' · ' + pullable + ' ' + t('pullable')),
          h('span', { style: styles.spacer }),
          h('button', { style: styles.button, disabled: busy, onClick: () => run('refresh') }, t('refresh')),
          h('button', { style: styles.button, disabled: busy, onClick: () => run('sync') }, t('syncAll')),
          h('button', {
            style: styles.button,
            disabled: busy,
            onClick: () => {
              const next = !hygieneOpen
              setHygieneOpen(next)
              if (next) void store.loadHygiene(false)
            },
          }, t('hygiene')),
          h('button', { style: styles.button, disabled: busy, onClick: () => setInstallOpen(!installOpen) }, '+ ' + t('install')),
        ),
        banner !== null && banner !== '' ? h('div', { style: styles.banner }, banner) : null,
        timeline !== null && timeline.events.length > 0
          ? h(
            'div',
            { style: styles.row },
            h('div', { style: styles.rowTop }, h('span', { style: styles.secondary }, t('timeline'))),
            ...timeline.events.slice(0, 6).map((event, index) => {
              const time = new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              const extra = event.kind === 'incoming' && Array.isArray(event.subjects) && event.subjects.length > 0
                ? ' · ' + event.subjects[0]
                : ''
              return h(
                'div',
                { key: index, style: styles.secondary },
                `${time} · ${event.bundle} · ${event.kind}: ${event.text ?? ''}${extra}`,
              )
            }),
          )
          : null,
        hygieneOpen
          ? h(
            'div',
            { style: styles.row },
            h(
              'div',
              { style: styles.rowTop },
              h('span', { style: styles.secondary }, t('hygiene')),
              h('span', { style: styles.spacer }),
              h('button', {
                style: styles.button,
                disabled: hygiene !== null && hygiene.phase === 'loading',
                onClick: () => void store.loadHygiene(true),
              }, t('scan')),
              h('button', { style: styles.button, onClick: () => setHygieneOpen(false) }, t('close')),
            ),
            hygiene === null || hygiene.phase === 'loading' ? h('div', { style: styles.empty }, t('loading')) : null,
            hygiene !== null && hygiene.error ? h('div', { style: styles.error }, hygiene.error) : null,
            hygiene !== null && hygiene.phase === 'ready' && hygiene.findings.length === 0
              ? h('div', { style: styles.secondary }, t('noHygieneFindings'))
              : null,
            hygiene !== null && hygiene.phase === 'ready'
              ? hygiene.findings.map((finding, index) => {
                const label = finding.kind === 'unmerged-branch'
                  ? `${finding.kind}: ${finding.name} — ${(finding.branches || []).join(', ')}`
                  : `${finding.kind}: ${finding.name}`
                return h('div', { key: index, style: styles.secondary }, label + (finding.suggestion ? ' · ' + finding.suggestion : ''))
              })
              : null,
          )
          : null,
        state.phase === 'error' ? h('div', { style: styles.error }, t('transportError')) : null,
        state.phase === 'loading' ? h('div', { style: styles.empty }, t('loading')) : null,
        rows.length === 0 && state.phase === 'ready' ? h('div', { style: styles.empty }, t('noBundles')) : null,
        installOpen
          ? h(
            'div',
            { style: styles.row },
            h(
              'div',
              { style: styles.controls },
              h(
                'select',
                {
                  style: styles.select,
                  value: installDoor,
                  disabled: busy,
                  onChange: (event) => setInstallDoor(event.target.value),
                },
                h('option', { value: 'directory' }, t('directory')),
                h('option', { value: 'repository' }, t('repository')),
                h('option', { value: 'organisation' }, t('organisation')),
              ),
              installDoor === 'organisation'
                ? [
                  h(
                    'select',
                    {
                      key: 'owner',
                      style: styles.select,
                      value: catalogOwner,
                      disabled: busy,
                      onChange: (event) => {
                        setCatalogOwner(event.target.value)
                        setCatalogRepo('')
                      },
                    },
                    catalogOwners.map((owner) => h('option', { key: owner, value: owner }, owner)),
                  ),
                  h('button', {
                    key: 'refresh-catalog',
                    style: styles.button,
                    disabled: busy || catalog?.phase === 'loading',
                    onClick: () => void store.loadCatalog(true),
                  }, t('refreshCatalog')),
                  h(
                    'select',
                    {
                      key: 'repo',
                      style: styles.select,
                      value: catalogRepo,
                      disabled: busy || catalogRepos.length === 0,
                      onChange: (event) => setCatalogRepo(event.target.value),
                    },
                    catalogRepos.length === 0
                      ? h('option', { value: '' }, catalog?.phase === 'loading' ? t('loading') : t('catalogEmpty'))
                      : catalogRepos.map((entry) => h(
                        'option',
                        { key: entry.fullName, value: entry.fullName },
                        entry.archived ? entry.name + ' · archived' : entry.name,
                      )),
                  ),
                  h('button', {
                    key: 'install-organisation',
                    style: styles.button,
                    disabled: busy || catalogRepo === '',
                    onClick: () => run('install', { door: 'repository', spec: catalogRepo }),
                  }, t('install')),
                ]
                : [
                  h('input', {
                    key: 'spec',
                    style: styles.input,
                    value: installSpec,
                    disabled: busy,
                    placeholder: installDoor === 'directory' ? t('directoryPlaceholder') : t('repositoryPlaceholder'),
                    onChange: (event) => setInstallSpec(event.target.value),
                  }),
                  installDoor === 'directory'
                    ? h('button', {
                      key: 'browse',
                      style: styles.button,
                      disabled: busy,
                      onClick: () => {
                        void store.act('browse').then((result) => {
                          if (result !== null && result.ok === true && typeof result.path === 'string') {
                            setInstallSpec(result.path)
                          }
                        })
                      },
                    }, t('browse'))
                    : null,
                  h('button', {
                    key: 'install',
                    style: styles.button,
                    disabled: busy || installSpec.trim() === '',
                    onClick: () => run('install', { door: installDoor, spec: installSpec.trim() }),
                  }, t('install')),
                ],
            ),
            h(
              'div',
              { style: styles.secondary },
              installDoor === 'organisation'
                ? (ownerEntry !== null && ownerEntry.error ? ownerEntry.error : t('installOrganisationHint'))
                : installDoor === 'directory' ? t('installDirectoryHint') : t('installRepositoryHint'),
            ),
          )
          : null,
        rows.map(rowView),
      )
    }

    /** The Settings navigation glyph: the same butterfly mark. */
    function viburnumSettingsIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 16
      return h('img', {
        src: ICON_DATA,
        alt: '',
        width: size,
        height: size,
        style: { display: 'block', objectFit: 'contain' },
      })
    }

    /** Settings → viburnum: the check schedule and harness compatibility. */
    function viburnumSettings(props) {
      const store = props.store
      const t = props.locale.bind(NS)
      const state = useStore(store)
      const snapshot = state.snapshot || { rows: [], settings: {}, compat: {} }
      const settings = snapshot.settings || {}
      const compat = snapshot.compat || {}
      const [minutes, setMinutes] = React.useState(String(settings.checkIntervalMinutes ?? 5))
      const [startup, setStartup] = React.useState(settings.refreshOnStartup !== false)
      const [warnings, setWarnings] = React.useState(settings.versionWarnings !== false)
      const [shelf, setShelf] = React.useState(typeof settings.pluginsDir === 'string' ? settings.pluginsDir : '')

      React.useEffect(() => {
        setMinutes(String(settings.checkIntervalMinutes ?? 5))
        setStartup(settings.refreshOnStartup !== false)
        setWarnings(settings.versionWarnings !== false)
        setShelf(typeof settings.pluginsDir === 'string' ? settings.pluginsDir : '')
      }, [settings.checkIntervalMinutes, settings.refreshOnStartup, settings.versionWarnings, settings.pluginsDir])

      const save = () => {
        void store.saveSettings({
          checkIntervalMinutes: Number.parseInt(minutes, 10),
          refreshOnStartup: startup,
          versionWarnings: warnings,
          pluginsDir: shelf.trim(),
        })
      }
      const notes = Array.isArray(compat.warnings) ? compat.warnings : []

      return h(
        'div',
        { style: styles.settingsPage },
        h('div', { style: styles.title }, t('settingsTitle')),
        h('div', { style: styles.secondary }, t('settingsHint')),
        h(
          'div',
          { style: styles.controls },
          h('span', { style: styles.secondary }, t('refreshInterval')),
          h('input', {
            style: styles.input,
            type: 'number',
            min: 0,
            max: 1440,
            value: minutes,
            onChange: (event) => setMinutes(event.target.value),
          }),
        ),
        h(
          'label',
          { style: styles.controls },
          h('input', { type: 'checkbox', checked: startup, onChange: (event) => setStartup(event.target.checked) }),
          h('span', { style: styles.secondary }, t('refreshOnStartup')),
        ),
        h(
          'label',
          { style: styles.controls },
          h('input', { type: 'checkbox', checked: warnings, onChange: (event) => setWarnings(event.target.checked) }),
          h('span', { style: styles.secondary }, t('versionWarnings')),
        ),
        h(
          'label',
          { style: styles.controls },
          h('span', { style: styles.secondary }, t('shelfDir')),
          h('input', {
            style: styles.input,
            value: shelf,
            placeholder: snapshot.shelfDirectory || '',
            onChange: (event) => setShelf(event.target.value),
          }),
          h('button', {
            style: styles.button,
            disabled: state.busy !== null,
            onClick: () => {
              void store.act('browse').then((result) => {
                if (result !== null && result.ok === true && typeof result.path === 'string') setShelf(result.path)
              })
            },
          }, t('browse')),
          h('button', { style: styles.button, onClick: () => setShelf('') }, t('useDefault')),
        ),
        h('div', { style: styles.secondary }, t('shelfDirHint') + ' ' + (snapshot.shelfDirectory || '')),
        h(
          'div',
          { style: styles.controls },
          h('button', { style: styles.button, disabled: state.busy !== null, onClick: save }, t('save')),
          state.last ? h('span', { style: styles.secondary }, describeResult(state.last, t)) : null,
        ),
        h(
          'div',
          { style: styles.row },
          h('div', { style: styles.rowTop }, h('span', { style: styles.secondary }, t('harnessCompat'))),
          compat.runningDsh ? h('div', { style: styles.secondary }, t('runningHarness') + ': ' + compat.runningDsh) : null,
          notes.length > 0
            ? notes.map((warning, index) => h('div', { key: index, style: styles.error }, warning.message))
            : h('div', { style: styles.secondary }, t('noVersionWarnings')),
        ),
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

        ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: 'viburnum',
            order: 6,
            label: () => ctx.locale.bind(NS)('title'),
            locale: NS,
            inject: () => ({ store, locale: ctx.locale }),
          },
          viburnumSettings,
        ))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register(
          { name: 'settings.section.icon', id: 'viburnum' },
          viburnumSettingsIcon,
        ))
      },
    }
  },
})
