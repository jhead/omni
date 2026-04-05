#!/usr/bin/env bun
/**
 * Interactive test harness for @omnibot/omnimux.
 *
 * Streams PTY output to stdout and forwards each stdin line to the PTY (with Enter).
 * The library defaults to sanitizing host-terminal env (e.g. iTerm’s `ITERM_*`) so TUIs
 * do not emit iTerm-only sequences that show as garbage; override with
 * `createOmnimux({ sanitizeHostTerminalEnv: false })` if you need the full parent env.
 *
 * Usage:
 *   bun examples/cli.ts claude
 *   bun examples/cli.ts --cwd ~/myrepo -- claude --verbose
 *   bun examples/cli.ts --rule "Press enter" -- claude
 *
 * Special stdin lines (after the session starts):
 *   :key Enter | Escape | Tab | Ctrl+C | Up | Down | Left | Right  — send a named key
 *   :raw <text>  — write text without a trailing Enter
 *   :quit        — exit
 */

import * as readline from "node:readline";
import { createOmnimux } from "../src/index.ts";
import type { KnownKey } from "../src/keys.ts";

const KEY_ALIASES: Record<string, KnownKey> = {
  enter: "Enter",
  escape: "Escape",
  tab: "Tab",
  "ctrl+c": "Ctrl+C",
  "ctrl+d": "Ctrl+D",
  "ctrl+z": "Ctrl+Z",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  backspace: "Backspace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

function parseArgs(argv: string[]) {
  let cwd: string | undefined;
  let ruleMatch: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
      continue;
    }
    if (a === "--rule" && argv[i + 1]) {
      ruleMatch = argv[++i];
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
    rest.push(a);
  }
  return { cwd, ruleMatch, cmd: rest };
}

function printHelp(): void {
  console.log(`omnimux example CLI

Usage:
  bun examples/cli.ts [options] <command> [args...]
  bun examples/cli.ts [options] -- <command> [args...]

Options:
  --cwd <path>     Working directory for the PTY
  --rule <text>    When plain output contains this substring, send Enter once (demo)
  -h, --help       Show this help

Stdin commands (interactive):
  :key <name>   Named key (${Object.keys(KEY_ALIASES).join(", ")})
  :raw <text>   Write raw text (no Enter)
  :quit         Exit
`);
}

function main(): void {
  const { cwd, ruleMatch, cmd } = parseArgs(process.argv.slice(2));
  if (cmd.length === 0) {
    console.error("error: missing command (e.g. claude or -- claude)");
    printHelp();
    process.exit(1);
  }

  const mux = createOmnimux({ cwd });
  const session = mux.createSession({
    cmd: cmd as [string, ...string[]],
    ...(cwd !== undefined ? { cwd } : {}),
    onRuleError: (err, rule) => {
      console.error("[rule error]", err, rule.id ?? "");
    },
  });

  if (ruleMatch !== undefined) {
    session.addRule({
      id: "cli-demo-enter",
      match: ruleMatch,
      once: true,
      run: async (h) => {
        console.error(`[rule] matched ${JSON.stringify(ruleMatch)} -> Enter`);
        h.sendKey("Enter");
      },
    });
  }

  session.onOutput((chunk) => {
    process.stdout.write(chunk);
  });

  // Echo typed lines to stderr so stdout stays dedicated to the PTY (full-screen TUIs).
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  rl.setPrompt("");

  console.error(`[omnimux] pid=${session.pid} id=${session.id} — stdin lines → PTY+Enter; :key / :raw / :quit (typed echo on stderr)\n`);

  rl.on("line", (line) => {
    const trimmed = line.trimEnd();
    if (trimmed === ":quit" || trimmed === ":q") {
      session.dispose();
      rl.close();
      return;
    }
    if (trimmed.startsWith(":key ")) {
      const name = trimmed.slice(5).trim().toLowerCase();
      const key = KEY_ALIASES[name];
      if (!key) {
        console.error(`unknown key: ${name}`);
        return;
      }
      session.sendKey(key);
      return;
    }
    if (trimmed.startsWith(":raw ")) {
      session.write(trimmed.slice(5));
      return;
    }
    session.write(line + "\r");
  });

  rl.on("close", () => {
    session.dispose();
  });

  void session.exited.then((code) => {
    console.error(`\n[omnimux] exited with code ${code}`);
    process.exit(code === -1 ? 0 : code);
  });
}

main();
