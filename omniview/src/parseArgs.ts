export type ParsedCli =
  | { help: true }
  | {
      help: false;
      cwd: string | undefined;
      count: number;
      cmd: [string, ...string[]];
    };

export function parseArgs(argv: string[]): ParsedCli {
  let cwd: string | undefined;
  let count = 1;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) break;
    if (a === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
      continue;
    }
    if (a === "--count" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i]!, 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`omniview: --count must be a positive integer`);
      }
      count = n;
      continue;
    }
    if (a === "--help" || a === "-h") {
      return { help: true };
    }
    rest.push(a);
  }

  if (rest.length === 0) {
    throw new Error("omniview: missing command (e.g. omniview -- claude)");
  }

  const cmd = rest as [string, ...string[]];
  return { help: false, cwd, count, cmd };
}

export function printHelp(): void {
  console.log(`omniview — multi-pane PTY dashboard (Ink + omnimux + xterm headless)

Usage:
  bun src/index.tsx [options] [--] <command> [args...]

Options:
  --cwd <path>     Working directory for each PTY session
  --count <n>      Number of identical sessions to spawn (default: 1)
  -h, --help       Show this help

Examples:
  omniview --count 4 -- claude
  omniview --cwd ~/proj -- claude --verbose

Keys:
  Tab / Shift+Tab   Focus next / previous pane
  Ctrl+C            Send to focused pane (does not quit omniview)
  q                 Quit omniview
`);
}
