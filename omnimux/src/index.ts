/**
 * @packageDocumentation
 * Programmatic PTY multiplexer for Bun using `bun-pty`: spawn interactive TUI processes,
 * subscribe to output, send keys, and register text/regex rules.
 *
 * @remarks
 * Requires the **Bun** runtime. PTY support is provided by the `bun-pty` package; see its
 * documentation for supported platforms (macOS, Linux, Windows).
 */

export { createOmnimux, Omnimux } from "./omnimux.ts";
export { TerminalSession } from "./session.ts";
export { stripAnsi } from "./ansi.ts";
export type { KnownKey } from "./keys.ts";
export { keyToSequence } from "./keys.ts";
export type {
  CreateSessionOptions,
  OmnimuxOptions,
  RuleDefinition,
  RuleHandle,
  RuleHandlerContext,
} from "./types.ts";
