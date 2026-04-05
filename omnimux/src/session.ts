import { spawn as ptySpawn, type IPty } from "bun-pty";
import { stripAnsi } from "./ansi.ts";
import type { KnownKey } from "./keys.ts";
import { keyToSequence } from "./keys.ts";
import { RawRingBuffer } from "./rawRing.ts";
import { testMatch } from "./rules.ts";
import type {
  RuleDefinition,
  RuleHandle,
  RuleHandlerContext,
  SessionSpawnArgs,
} from "./types.ts";

const DEFAULT_RING = 1024 * 1024;
const DEFAULT_PLAIN_TAIL = 65536;

interface InternalRule {
  id: number;
  def: RuleDefinition;
  fired: boolean;
  lastRunMs: number | undefined;
  removed: boolean;
}

/**
 * One PTY-backed session: spawn, output subscribers, rules, and I/O helpers.
 * Constructed via {@link Omnimux.createSession}.
 */
export class TerminalSession {
  readonly id: string;
  private readonly pty: IPty;
  private readonly rawRing: RawRingBuffer;
  private plainTail = "";
  private readonly plainTailMax: number;
  private readonly outputListeners = new Set<(chunk: string) => void>();
  private readonly rules: InternalRule[] = [];
  private nextRuleId = 1;
  private ruleChain: Promise<void> = Promise.resolve();
  private exitCode: number | null = null;
  private readonly exitedPromise: Promise<number>;
  private resolveExited!: (code: number) => void;
  private exitSettled = false;
  private readonly onRuleError?: (error: unknown, rule: RuleDefinition) => void;
  private dataDisposable: { dispose: () => void };
  private exitDisposable: { dispose: () => void };
  private disposed = false;

  constructor(args: SessionSpawnArgs) {
    const { defaults, options } = args;
    this.id = options.id ?? crypto.randomUUID();
    this.onRuleError = options.onRuleError;
    const cmd = options.cmd;
    const file = cmd[0];
    const argsRest = cmd.slice(1);

    this.rawRing = new RawRingBuffer(options.ringBufferMaxBytes ?? DEFAULT_RING);
    this.plainTailMax = options.plainTailMaxChars ?? DEFAULT_PLAIN_TAIL;

    this.pty = ptySpawn(file, argsRest, {
      name: defaults.termName,
      cols: defaults.cols,
      rows: defaults.rows,
      ...(defaults.cwd !== undefined ? { cwd: defaults.cwd } : {}),
      env: defaults.env,
    });

    this.exitedPromise = new Promise<number>((resolve) => {
      this.resolveExited = resolve;
    });

    this.dataDisposable = this.pty.onData((data) => {
      if (this.disposed) return;
      this.rawRing.appendText(data);
      for (const fn of this.outputListeners) fn(data);
      const stripped = stripAnsi(data);
      if (stripped.length > 0) {
        this.plainTail += stripped;
        if (this.plainTail.length > this.plainTailMax) {
          this.plainTail = this.plainTail.slice(-this.plainTailMax);
        }
        this.evaluateRules();
      }
    });

    this.exitDisposable = this.pty.onExit((ev) => {
      this.settleExit(ev.exitCode);
    });
  }

  private settleExit(code: number): void {
    if (this.exitSettled) return;
    this.exitSettled = true;
    this.exitCode = code;
    this.resolveExited(code);
  }

  /** Resolves when the PTY process exits (with exit code). */
  get exited(): Promise<number> {
    return this.exitedPromise;
  }

  get pid(): number {
    return this.pty.pid;
  }

  /** Last known exit code after the process has exited; otherwise `null`. */
  get lastExitCode(): number | null {
    return this.exitCode;
  }

  /**
   * Subscribe to raw PTY output (ANSI string chunks). Returns an unsubscribe function.
   */
  onOutput(listener: (chunk: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => {
      this.outputListeners.delete(listener);
    };
  }

  /** Write bytes or UTF-8 text to the PTY. */
  write(data: string | Uint8Array): void {
    if (this.disposed) return;
    if (typeof data === "string") {
      this.pty.write(data);
      return;
    }
    const dec = new TextDecoder();
    this.pty.write(dec.decode(data));
  }

  sendKey(key: KnownKey): void {
    if (this.disposed) return;
    this.pty.write(keyToSequence(key));
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    this.pty.resize(cols, rows);
  }

  /** Kill the PTY process (default `SIGTERM`). */
  kill(signal?: string): void {
    if (this.disposed) return;
    this.pty.kill(signal);
  }

  /** Recent raw output as UTF-8 (may be partial at chunk boundaries). */
  getRawSnapshot(): string {
    const dec = new TextDecoder();
    return dec.decode(this.rawRing.snapshotBytes());
  }

  /** Plain-text tail used for rule matching (ANSI stripped). */
  getPlainTail(): string {
    return this.plainTail;
  }

  addRule(def: RuleDefinition): RuleHandle {
    const id = this.nextRuleId++;
    const internal: InternalRule = {
      id,
      def,
      fired: false,
      lastRunMs: undefined,
      removed: false,
    };
    this.rules.push(internal);
    const self = this;
    return {
      id,
      remove() {
        internal.removed = true;
        const idx = self.rules.indexOf(internal);
        if (idx >= 0) self.rules.splice(idx, 1);
      },
    };
  }

  /**
   * Unsubscribe PTY listeners, clear output subscribers, kill the process if still running,
   * and settle {@link exited} with `-1` if the process had not exited yet.
   */
  dispose(signal?: string): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dataDisposable.dispose();
    this.exitDisposable.dispose();
    this.outputListeners.clear();
    if (!this.exitSettled) {
      this.settleExit(-1);
    }
    try {
      this.pty.kill(signal ?? "SIGTERM");
    } catch {
      /* ignore */
    }
  }

  private createHandlerContext(): RuleHandlerContext {
    return {
      sessionId: this.id,
      write: (data) => {
        this.write(data);
      },
      sendKey: (key) => {
        this.sendKey(key);
      },
      resize: (cols, rows) => {
        this.resize(cols, rows);
      },
    };
  }

  private evaluateRules(): void {
    const text = this.plainTail;
    const snapshot = [...this.rules];
    for (const state of snapshot) {
      if (state.removed) continue;
      const def = state.def;
      if (def.once && state.fired) continue;
      const cool = def.cooldownMs;
      if (cool !== undefined && state.lastRunMs !== undefined) {
        if (Date.now() - state.lastRunMs < cool) continue;
      }
      if (!testMatch(def.match, text)) continue;

      state.lastRunMs = Date.now();
      if (def.once) state.fired = true;

      const ctx = this.createHandlerContext();
      const run = def.run;
      this.ruleChain = this.ruleChain
        .then(() => run(ctx))
        .catch((err: unknown) => {
          if (this.onRuleError) {
            this.onRuleError(err, def);
            return;
          }
          throw err;
        });
    }
  }
}
