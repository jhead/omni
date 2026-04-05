import { sanitizeTerminalEnv, stringifyEnv } from "./env.ts";
import { TerminalSession } from "./session.ts";
import type { CreateSessionOptions, OmnimuxOptions, ResolvedMuxDefaults } from "./types.ts";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_TERM = "xterm-256color";

/**
 * Registry for multiple PTY sessions with shared default options.
 *
 * Requires the **Bun** runtime and the `bun-pty` native addon (see `bun-pty` docs for platform support).
 */
export class Omnimux {
  private readonly sessions = new Map<string, TerminalSession>();
  readonly defaultCols: number;
  readonly defaultRows: number;
  readonly defaultTermName: string;
  readonly defaultCwd: string | undefined;
  /** Base env (`process.env` + omnimux ctor `env`); per-session merge applies {@link sanitizeTerminalEnv} when enabled. */
  readonly defaultEnv: Record<string, string>;
  private readonly sanitizeHostTerminalEnv: boolean;

  constructor(options: OmnimuxOptions = {}) {
    this.defaultCols = options.cols ?? DEFAULT_COLS;
    this.defaultRows = options.rows ?? DEFAULT_ROWS;
    this.defaultTermName = options.termName ?? DEFAULT_TERM;
    this.defaultCwd = options.cwd;
    this.defaultEnv = { ...stringifyEnv(process.env), ...options.env };
    this.sanitizeHostTerminalEnv = options.sanitizeHostTerminalEnv ?? true;
  }

  /** Create a PTY session; throws if `options.id` collides with an existing session. */
  createSession(options: CreateSessionOptions): TerminalSession {
    const defaults = this.resolveDefaults(options);
    if (options.id !== undefined && this.sessions.has(options.id)) {
      throw new Error(`omnimux: duplicate session id ${JSON.stringify(options.id)}`);
    }
    const session = new TerminalSession({ defaults, options });
    this.sessions.set(session.id, session);
    void session.exited.finally(() => {
      this.sessions.delete(session.id);
    });
    return session;
  }

  private resolveDefaults(overrides: CreateSessionOptions): ResolvedMuxDefaults {
    const cols = overrides.cols ?? this.defaultCols;
    const rows = overrides.rows ?? this.defaultRows;
    const termName = overrides.termName ?? this.defaultTermName;
    const cwd = overrides.cwd ?? this.defaultCwd;
    const merged = { ...this.defaultEnv, ...overrides.env };
    const sanitize = overrides.sanitizeHostTerminalEnv ?? this.sanitizeHostTerminalEnv;
    const env =
      sanitize !== false
        ? sanitizeTerminalEnv(merged, { term: termName, cols, rows })
        : { ...merged, TERM: merged.TERM ?? termName };

    return {
      cols,
      rows,
      termName,
      cwd,
      env,
    };
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  /** Active sessions (including those whose process has not exited yet). */
  list(): TerminalSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Remove the session from the registry, {@link TerminalSession.dispose dispose} it,
   * and send `SIGTERM` (or `signal`) to the PTY process.
   */
  destroy(id: string, signal?: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.dispose(signal);
  }
}

/** Create a new {@link Omnimux} registry. */
export function createOmnimux(options?: OmnimuxOptions): Omnimux {
  return new Omnimux(options);
}
