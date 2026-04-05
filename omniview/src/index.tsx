#!/usr/bin/env bun
import { render } from "ink";
import { parseArgs, printHelp } from "./parseArgs.ts";
import { OmniviewApp } from "./app.tsx";

function main(): void {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
    return;
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
    return;
  }

  render(
    <OmniviewApp cwd={parsed.cwd} count={parsed.count} cmd={parsed.cmd} />,
    {
      exitOnCtrlC: false,
      maxFps: 30,
    },
  );
}

main();
