/**
 * Smoke tests for integration harness utilities (ports, temp dirs, waitFor).
 * Phase 1 gateway/E2E tests should live alongside and use these helpers.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import {
  createTempDir,
  getListenPort,
  tempSqlitePath,
  waitFor,
} from './helpers.ts'

describe('integration harness helpers', () => {
  test('getListenPort returns a positive port', async () => {
    const port = await getListenPort()
    expect(port).toBeGreaterThan(0)
  })

  test('getListenPort can bind Bun.serve on returned port', async () => {
    const port = await getListenPort()
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch: () => new Response('ok'),
    })
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      expect(res.ok).toBe(true)
      expect(await res.text()).toBe('ok')
    } finally {
      server.stop()
    }
  })

  test('createTempDir + tempSqlitePath yields writable path', async () => {
    const dir = await createTempDir()
    const db = await tempSqlitePath(dir, 'queue.db')
    await writeFile(db, '', 'utf8')
    const f = Bun.file(db)
    expect(await f.exists()).toBe(true)
  })

  test('waitFor resolves when condition becomes true', async () => {
    let n = 0
    await waitFor(
      () => {
        n++
        return n >= 2
      },
      { intervalMs: 5, timeoutMs: 1000, label: 'n>=2' },
    )
    expect(n).toBeGreaterThanOrEqual(2)
  })

  test('waitFor throws when condition never holds', async () => {
    await expect(
      waitFor(() => false, { intervalMs: 5, timeoutMs: 80, label: 'never' }),
    ).rejects.toThrow(/never/)
  })
})
