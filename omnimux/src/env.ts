/** Coerce environment maps into strict `string` values for PTY `env`. */
export function stringifyEnv(
  base: Record<string, string | undefined>,
): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === "string") o[k] = v;
  }
  return o;
}

/** Keys that make TUIs think they are still inside the user’s Terminal.app / iTerm / etc. */
const HOST_TERMINAL_KEY_PATTERNS: RegExp[] = [
  /^ITERM_/,
  /^TERM_PROGRAM$/,
  /^TERM_PROGRAM_VERSION$/,
  /^TERM_SESSION_ID$/,
  /^VTE_VERSION$/,
  /^GNOME_TERMINAL_/,
  /^KONSOLE_/,
  /^WT_SESSION$/, // Windows Terminal
  /^WT_PROFILE_ID$/,
];

/**
 * Drop host-terminal metadata and align `TERM` / `COLUMNS` / `LINES` with the PTY we expose.
 */
export function sanitizeTerminalEnv(
  env: Record<string, string>,
  opts: { term: string; cols: number; rows: number },
): Record<string, string> {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    for (const re of HOST_TERMINAL_KEY_PATTERNS) {
      if (re.test(key)) {
        delete out[key];
        break;
      }
    }
  }
  out.TERM = opts.term;
  out.COLUMNS = String(opts.cols);
  out.LINES = String(opts.rows);
  return out;
}
