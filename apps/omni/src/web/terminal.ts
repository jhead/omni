import { attachTerminal } from './terminal-attach.ts'

function main(): void {
  const params = new URLSearchParams(window.location.search)
  const id = params.get('id')
  const el = document.getElementById('app')
  if (!id || !el) {
    if (el) {
      el.textContent = 'Missing ?id= agent id'
    }
    return
  }

  const { dispose } = attachTerminal(id, el)

  window.addEventListener('beforeunload', () => {
    dispose()
  })
}

main()
