import { Terminal } from "@xterm/headless";
import { createOmnimux, type TerminalSession } from "@omnibot/omnimux";
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeGridLayout } from "./layout.ts";
import { Pane } from "./pane.tsx";
import { useTerminalSize } from "./useTerminalSize.ts";

const STATUS_ROWS = 1;
const TITLE_ROWS = 1;

export interface OmniviewAppProps {
  cwd: string | undefined;
  count: number;
  cmd: [string, ...string[]];
}

interface SessionHandle {
  term: Terminal;
  session: TerminalSession;
  unsub: () => void;
}

export function OmniviewApp({ cwd, count, cmd }: OmniviewAppProps) {
  const { columns, rows } = useTerminalSize();
  const { exit } = useApp();
  const sessionsRef = useRef<SessionHandle[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const focusRef = useRef(0);
  focusRef.current = focusIndex;
  const [renderTick, setRenderTick] = useState(0);
  /** Coalesces PTY output to one React update; `requestAnimationFrame` is missing in Bun CLI. */
  const pendingRedrawRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionsReady, setSessionsReady] = useState(false);
  /** `null` = still running; otherwise PTY process exit code (see TerminalSession.exited). */
  const [sessionExitCodes, setSessionExitCodes] = useState<(number | null)[]>([]);
  const sessionExitCodesRef = useRef(sessionExitCodes);
  sessionExitCodesRef.current = sessionExitCodes;

  const layout = useMemo(
    () => computeGridLayout(count, columns, rows, STATUS_ROWS),
    [count, columns, rows],
  );

  const scheduleRedraw = useCallback(() => {
    if (pendingRedrawRef.current !== null) return;
    pendingRedrawRef.current = setTimeout(() => {
      pendingRedrawRef.current = null;
      setRenderTick((t) => t + 1);
    }, 0);
  }, []);

  const cmdKey = cmd.join("\0");

  useEffect(() => {
    let cancelled = false;
    setSessionExitCodes(Array(count).fill(null));
    const mux = createOmnimux({
      cols: 80,
      rows: 24,
      ...(cwd !== undefined ? { cwd } : {}),
    });
    const handles: SessionHandle[] = [];
    for (let i = 0; i < count; i++) {
      const term = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 5000,
        disableStdin: true,
        // Required for `terminal.buffer` (used by XtermViewport); see xterm ITerminalOptions.allowProposedApi.
        allowProposedApi: true,
      });
      const session = mux.createSession({
        cmd,
        ...(cwd !== undefined ? { cwd } : {}),
        id: `omniview-${i}`,
        cols: 80,
        rows: 24,
      });
      const unsub = session.onOutput((chunk) => {
        term.write(chunk);
        scheduleRedraw();
      });
      handles.push({ term, session, unsub });

      void session.exited.then((code) => {
        if (cancelled) return;
        setSessionExitCodes((prev) => {
          const next = [...prev];
          next[i] = code;
          return next;
        });
      });
    }
    sessionsRef.current = handles;
    setSessionsReady(true);
    setFocusIndex(0);

    return () => {
      cancelled = true;
      if (pendingRedrawRef.current !== null) {
        clearTimeout(pendingRedrawRef.current);
        pendingRedrawRef.current = null;
      }
      for (const h of handles) {
        h.unsub();
        h.term.dispose();
        h.session.dispose();
      }
      sessionsRef.current = [];
      setSessionExitCodes([]);
      setSessionsReady(false);
    };
  }, [count, cmdKey, cwd, scheduleRedraw]);

  useEffect(() => {
    if (!sessionsReady) return;
    const handles = sessionsRef.current;
    for (let i = 0; i < handles.length; i++) {
      const pane = layout.panes[i];
      if (!pane) continue;
      const exitCode = sessionExitCodes[i] ?? null;
      const w = Math.max(1, pane.width);
      const { term, session } = handles[i]!;
      if (exitCode !== null) {
        term.resize(w, 1);
        session.resize(w, 1);
      } else {
        const bodyRows = Math.max(1, pane.height - TITLE_ROWS);
        term.resize(w, bodyRows);
        session.resize(w, bodyRows);
      }
    }
  }, [sessionsReady, layout, columns, rows, sessionExitCodes]);

  useInput((input, key) => {
    if (!sessionsReady) return;
    const handles = sessionsRef.current;
    if (handles.length === 0) return;

    if (key.tab && key.shift) {
      setFocusIndex((f) => (f - 1 + handles.length) % handles.length);
      return;
    }
    if (key.tab) {
      setFocusIndex((f) => (f + 1) % handles.length);
      return;
    }

    if ((input === "q" || input === "Q") && !key.ctrl && !key.meta) {
      exit();
      return;
    }

    const h = handles[focusRef.current];
    if (!h) return;

    const focusedExit = sessionExitCodesRef.current[focusRef.current] ?? null;
    if (focusedExit !== null) {
      return;
    }

    if (key.ctrl && input === "c") {
      h.session.sendKey("Ctrl+C");
      return;
    }

    if (key.return) {
      h.session.sendKey("Enter");
      return;
    }
    if (key.escape) {
      h.session.sendKey("Escape");
      return;
    }
    // Ink maps DEL (\x7f), which macOS uses for the main erase key, to `key.delete`, not `key.backspace`
    // (see ink parse-keypress: \x7f → name "delete"). Both should send backward erase (\x7f) like omnimux Backspace.
    if (key.backspace || key.delete) {
      h.session.sendKey("Backspace");
      return;
    }
    if (key.upArrow) {
      h.session.sendKey("Up");
      return;
    }
    if (key.downArrow) {
      h.session.sendKey("Down");
      return;
    }
    if (key.leftArrow) {
      h.session.sendKey("Left");
      return;
    }
    if (key.rightArrow) {
      h.session.sendKey("Right");
      return;
    }
    if (key.home) {
      h.session.sendKey("Home");
      return;
    }
    if (key.end) {
      h.session.sendKey("End");
      return;
    }
    if (key.pageUp) {
      h.session.sendKey("PageUp");
      return;
    }
    if (key.pageDown) {
      h.session.sendKey("PageDown");
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      h.session.write(input);
    }
  });

  if (!sessionsReady || sessionsRef.current.length !== count) {
    return (
      <Box>
        <Text color="yellow">Starting omniview…</Text>
      </Box>
    );
  }

  const handles = sessionsRef.current;
  const { gridRows, gridCols, panes } = layout;

  const gridRowsEls: ReactNode[] = [];
  for (let gr = 0; gr < gridRows; gr++) {
    const rowCells: React.ReactNode[] = [];
    let rowHeight = 1;
    for (let gc = 0; gc < gridCols; gc++) {
      const idx = gr * gridCols + gc;
      if (idx >= count) break;
      const pane = panes[idx];
      const h = handles[idx];
      if (!pane || !h) continue;
      rowHeight = pane.height;
      rowCells.push(
        <Pane
          key={idx}
          title={`${idx + 1}/${count} ${h.session.id}`}
          term={h.term}
          width={pane.width}
          height={pane.height}
          focused={idx === focusIndex}
          renderVersion={renderTick}
          exitCode={sessionExitCodes[idx] ?? null}
        />,
      );
    }
    if (rowCells.length > 0) {
      gridRowsEls.push(
        <Box key={gr} flexDirection="row" height={rowHeight} alignItems="flex-start">
          {rowCells}
        </Box>,
      );
    }
  }

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexDirection="column" flexGrow={1}>
        {gridRowsEls}
      </Box>
      <Box height={STATUS_ROWS} marginTop={0}>
        <Text dimColor>
          omniview | Tab / Shift+Tab focus | Ctrl+C to pane | q quit | focus {focusIndex + 1}/{count}
        </Text>
      </Box>
    </Box>
  );
}
