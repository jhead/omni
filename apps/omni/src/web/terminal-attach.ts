import { Terminal } from '@xterm/xterm'
import { AttachAddon } from '@xterm/addon-attach'
import { FitAddon } from '@xterm/addon-fit'

export function wsUrlForAgent(agentId: string): string {
  const u = new URL(window.location.href)
  const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProto}//${u.host}/ws/agents/${encodeURIComponent(agentId)}`
}

export interface AttachedTerminal {
  readonly terminal: Terminal
  dispose: () => void
}

/**
 * Open an xterm session attached to the agent PTY WebSocket, filling `container`.
 */
export function attachTerminal(agentId: string, container: HTMLElement): AttachedTerminal {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    theme: {
      background: '#0f1115',
      foreground: '#e8eaef',
    },
  })

  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container)
  fit.fit()

  const socket = new WebSocket(wsUrlForAgent(agentId))
  const attach = new AttachAddon(socket)
  term.loadAddon(attach)

  const sendResize = (): void => {
    if (socket.readyState !== WebSocket.OPEN) return
    socket.send(
      JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows,
      }),
    )
  }

  socket.addEventListener('open', () => {
    sendResize()
  })

  const ro = new ResizeObserver(() => {
    fit.fit()
    sendResize()
  })
  ro.observe(container)

  const dispose = (): void => {
    ro.disconnect()
    try {
      socket.close()
    } catch {
      /* ignore */
    }
    term.dispose()
  }

  return { terminal: term, dispose }
}
