import { attachTerminal, type AttachedTerminal } from './terminal-attach.ts'

const LS_KEY = 'omni_bearer_token'

function getToken(): string {
  return localStorage.getItem(LS_KEY) ?? ''
}

function setError(msg: string): void {
  const el = document.getElementById('err') as HTMLDivElement | null
  if (!el) return
  if (!msg) {
    el.hidden = true
    el.textContent = ''
    return
  }
  el.hidden = false
  el.textContent = msg
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init?.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(path, { ...init, headers })
}

type AgentRow = { id: string; status: string; exitCode?: number | null }

type TemplateRow = { id: string; name: string }

let attached: AttachedTerminal[] = []

async function refreshTemplates(): Promise<boolean> {
  const sel = document.getElementById('spawn-template') as HTMLSelectElement | null
  if (!sel) return true
  const res = await api('/api/agent-templates')
  if (!res.ok) {
    setError(`GET /api/agent-templates: ${res.status} ${await res.text()}`)
    sel.innerHTML = ''
    return false
  }
  const data = (await res.json()) as { templates: TemplateRow[] }
  const prev = sel.value
  sel.innerHTML = ''
  for (const t of data.templates) {
    const opt = document.createElement('option')
    opt.value = t.id
    opt.textContent = t.name === t.id ? t.id : `${t.name} (${t.id})`
    sel.appendChild(opt)
  }
  if (prev && [...sel.options].some(o => o.value === prev)) {
    sel.value = prev
  } else if ([...sel.options].some(o => o.value === 'default')) {
    sel.value = 'default'
  }
  return true
}

function disposeAllTerminals(): void {
  for (const a of attached) {
    a.dispose()
  }
  attached = []
}

function renderTiles(agents: AgentRow[]): void {
  const section = document.getElementById('tiles') as HTMLElement | null
  if (!section) return

  disposeAllTerminals()
  section.innerHTML = ''

  if (agents.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-tiles'
    empty.textContent = 'No agents yet. Spawn one to see terminals tiled here.'
    section.appendChild(empty)
    return
  }

  for (const a of agents) {
    const tile = document.createElement('article')
    tile.className = 'tile'

    const head = document.createElement('div')
    head.className = 'tile-head'
    const title = document.createElement('div')
    const exitBit =
      a.status === 'exited' && a.exitCode != null ?
        ` exit=${escapeHtml(String(a.exitCode))}`
      : ''
    title.innerHTML = `<code>${escapeHtml(a.id)}</code><div class="meta">${escapeHtml(a.status)}${exitBit}</div>`
    const actions = document.createElement('div')
    actions.className = 'tile-actions'
    const solo = document.createElement('a')
    solo.href = `/terminal?id=${encodeURIComponent(a.id)}`
    solo.textContent = 'Open solo'
    solo.title = 'Full-page terminal for this agent'
    actions.appendChild(solo)
    if (a.status === 'exited') {
      const restartBtn = document.createElement('button')
      restartBtn.type = 'button'
      restartBtn.className = 'tile-btn'
      restartBtn.textContent = 'Restart'
      restartBtn.title = 'Spawn a new session for this agent (same id, same config dir)'
      restartBtn.addEventListener('click', () => {
        void restartAgent(a.id)
      })
      actions.appendChild(restartBtn)
    }
    head.appendChild(title)
    head.appendChild(actions)

    const host = document.createElement('div')
    host.className = 'term-host'

    if (a.status === 'running') {
      tile.appendChild(head)
      tile.appendChild(host)
      section.appendChild(tile)
      attached.push(attachTerminal(a.id, host))
    } else {
      host.className = 'term-host term-host--inactive'
      host.textContent = 'Session ended — use Restart or spawn a new agent.'
      tile.appendChild(head)
      tile.appendChild(host)
      section.appendChild(tile)
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function refreshList(): Promise<void> {
  const templatesOk = await refreshTemplates()
  if (!templatesOk) {
    disposeAllTerminals()
    const section = document.getElementById('tiles')
    if (section) section.innerHTML = ''
    return
  }
  setError('')
  const res = await api('/api/agents')
  if (!res.ok) {
    setError(`GET /api/agents: ${res.status} ${await res.text()}`)
    disposeAllTerminals()
    const section = document.getElementById('tiles')
    if (section) section.innerHTML = ''
    return
  }
  const data = (await res.json()) as { agents: AgentRow[] }
  renderTiles(data.agents)
}

async function spawnAgent(): Promise<void> {
  setError('')
  const sel = document.getElementById('spawn-template') as HTMLSelectElement | null
  const templateId = sel?.value?.trim() || 'default'
  const res = await api('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ templateId }),
  })
  if (!res.ok) {
    setError(`POST /api/agents: ${res.status} ${await res.text()}`)
    return
  }
  await refreshList()
}

async function restartAgent(id: string): Promise<void> {
  setError('')
  const res = await api(`/api/agents/${encodeURIComponent(id)}/restart`, {
    method: 'POST',
  })
  if (!res.ok) {
    setError(`Restart: ${res.status} ${await res.text()}`)
    return
  }
  await refreshList()
}

function main(): void {
  const tokenInput = document.getElementById('token') as HTMLInputElement | null
  if (tokenInput) {
    tokenInput.value = getToken()
  }

  document.getElementById('save')?.addEventListener('click', () => {
    const v = tokenInput?.value?.trim() ?? ''
    localStorage.setItem(LS_KEY, v)
    setError('')
    void refreshList()
  })

  document.getElementById('refresh')?.addEventListener('click', () => {
    void refreshList()
  })

  document.getElementById('spawn')?.addEventListener('click', () => {
    void spawnAgent()
  })

  window.addEventListener('beforeunload', () => {
    disposeAllTerminals()
  })

  void refreshList()
}

main()
