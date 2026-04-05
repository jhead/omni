import type { KnownKey } from "./keys.ts";

/** Options shared when creating an {@link Omnimux}. */
export interface OmnimuxOptions {
  /** Default terminal width (columns). */
  cols?: number;
  /** Default terminal height (rows). */
  rows?: number;
  /** TERM name passed to `bun-pty` (e.g. `xterm-256color`). */
  termName?: string;
  /**
   * When `true` (default), remove host-terminal-specific variables (e.g. iTerm’s `ITERM_*`,
   * `TERM_PROGRAM`) and set `TERM` / `COLUMNS` / `LINES` for a generic PTY. This avoids
   * TUI stacks detecting iTerm2 and emitting sequences that show up as literal garbage in a
   * non-embed PTY.
   */
  sanitizeHostTerminalEnv?: boolean;
  /** Default working directory for new sessions. */
  cwd?: string;
  /** Default environment for new sessions (merged with `process.env` when omitted per session). */
  env?: Record<string, string>;
}

/** Options for spawning a PTY session. */
export interface CreateSessionOptions {
  /** Executable and arguments (e.g. `["claude"]` or `["/usr/bin/bash", "-lc", "claude"]`). */
  cmd: [string, ...string[]];
  /** Override session id (must be unique across the mux). */
  id?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** TERM name for `bun-pty`. */
  termName?: string;
  /**
   * Override {@link OmnimuxOptions.sanitizeHostTerminalEnv} for this session only.
   * When omitted, the mux default applies.
   */
  sanitizeHostTerminalEnv?: boolean;
  /** Max raw output retained in the ring buffer (bytes). Default 1 MiB. */
  ringBufferMaxBytes?: number;
  /** Max plain-text tail length for matching (characters after ANSI strip). Default 65536. */
  plainTailMaxChars?: number;
  /**
   * Invoked when a rule handler throws. If unset, errors propagate to the rule queue
   * and may surface as unhandled promise rejections unless handled.
   */
  onRuleError?: (error: unknown, rule: RuleDefinition) => void;
}

/** Rule definition for programmatic reactions to screen text. */
export interface RuleDefinition {
  /** Optional stable id for debugging. */
  id?: string;
  /** Substring match, or regex tested against the plain-text tail. */
  match: string | RegExp;
  /** Handler receives a minimal API (no full session to avoid cycles). */
  run: (ctx: RuleHandlerContext) => void | Promise<void>;
  /** If true, rule runs at most once. */
  once?: boolean;
  /** Minimum milliseconds between invocations. */
  cooldownMs?: number;
}

/** Context passed to rule handlers. */
export interface RuleHandlerContext {
  readonly sessionId: string;
  write(data: string | Uint8Array): void;
  sendKey(key: KnownKey): void;
  resize(cols: number, rows: number): void;
}

/** Handle returned from {@link TerminalSession.addRule} for removal. */
export interface RuleHandle {
  readonly id: number;
  remove(): void;
}

/** Resolved defaults when spawning a session. @internal */
export interface ResolvedMuxDefaults {
  cols: number;
  rows: number;
  termName: string;
  cwd: string | undefined;
  env: Record<string, string>;
}

/** @internal */
export interface SessionSpawnArgs {
  defaults: ResolvedMuxDefaults;
  options: CreateSessionOptions;
}
