/**
 * Integration test harness (PLAN-aligned).
 *
 * Agent completion gates:
 * - `bun test` (npm script `test`) — must exit 0 for core + harness smoke; canonical loop until green.
 * - `test:core` — `@omnibot/core` only (`validateOmniDispatch`, PLAN §6).
 * - `test:integration` — harness helpers + future gateway tests under `tests/integration/`.
 * - Phase 1 E2E (webhook → queue → IPC → MCP): add subprocess tests when packages exist; optionally
 *   require `RUN_PHASE1_E2E=1` in CI so default `test` stays fast. Do not use blanket `describe.skip`
 *   as the only Phase 1 signal (false green).
 *
 * Add Phase 1 gateway tests in `tests/integration/` (e.g. `phase1.gateway.test.ts`) alongside the
 * feature; use `getListenPort`, `createTempDir`, `waitFor` for ports, SQLite paths, and readiness.
 */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export type WaitForOptions = {
  /** Total timeout in ms (default 5000). */
  timeoutMs?: number
  /** Poll interval in ms (default 50). */
  intervalMs?: number
  /** Label for assertion messages when condition never becomes true. */
  label?: string
}

/**
 * Resolves when `condition()` returns true, or throws if `timeoutMs` elapses.
 * Use for gateway/IPC readiness instead of fixed sleeps (PLAN integration tests).
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: WaitForOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000
  const intervalMs = options.intervalMs ?? 50
  const label = options.label ?? 'condition'
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: ${label} not satisfied within ${timeoutMs}ms`)
    }
    await new Promise<void>(r => setTimeout(r, intervalMs))
  }
}

/**
 * Returns a TCP port chosen by the OS (avoids fixed :8080 collisions in CI).
 */
export async function getListenPort(): Promise<number> {
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data() {},
    },
  })
  const port = server.port
  server.stop()
  return port
}

/**
 * Creates a temporary directory for SQLite DB files or UDS paths.
 */
export async function createTempDir(prefix = 'omni-test-'): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), prefix))
  return base
}

/**
 * Ensures a unique SQLite path under a temp dir (caller creates parent via createTempDir).
 */
export async function tempSqlitePath(dir: string, name = 'test.db'): Promise<string> {
  await mkdir(dir, { recursive: true })
  return join(dir, name)
}
