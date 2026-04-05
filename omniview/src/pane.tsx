import { Box, Text } from "ink";
import type { Terminal } from "@xterm/headless";
import type { ReactNode } from "react";
import { XtermViewport } from "./xtermBuffer.tsx";

const TITLE_ROWS = 1;

export interface PaneProps {
  title: string;
  term: Terminal;
  width: number;
  height: number;
  focused: boolean;
  renderVersion: number;
  /** When set, the PTY child has exited; full pane shows centered status (no xterm). */
  exitCode: number | null;
}

function exitLabelText(exitCode: number): string {
  if (exitCode === -1) return "disposed";
  if (exitCode === 130) return "130 (SIGINT)";
  return String(exitCode);
}

export function Pane({
  title,
  term,
  width,
  height,
  focused,
  renderVersion,
  exitCode,
}: PaneProps): ReactNode {
  const titleColor = focused ? "cyan" : "gray";

  if (exitCode !== null) {
    const label = exitLabelText(exitCode);
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        backgroundColor="#2a2a2a"
        justifyContent="center"
        alignItems="center"
        borderStyle={focused ? "round" : "single"}
        borderColor={focused ? "cyan" : "gray"}
      >
        <Box flexDirection="column" alignItems="center" rowGap={1} paddingX={1}>
          <Text bold color="white">
            Session ended
          </Text>
          <Text dimColor color="gray">
            {title}
          </Text>
          <Text color="red" bold>
            Exit {label}
          </Text>
        </Box>
      </Box>
    );
  }

  const bodyHeight = Math.max(1, height - TITLE_ROWS);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} width={width}>
        <Text bold color={titleColor} wrap="truncate">
          {focused ? "▶ " : "  "}
          {title}
        </Text>
      </Box>
      <Box width={width} height={bodyHeight}>
        <XtermViewport term={term} renderVersion={renderVersion} />
      </Box>
    </Box>
  );
}
