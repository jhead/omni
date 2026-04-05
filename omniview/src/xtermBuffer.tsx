import type { IBufferCell, IBufferLine, Terminal } from "@xterm/headless";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { ansi256ToHex } from "./ansi256.ts";

function cellFgStyle(cell: IBufferCell): { color?: string } {
  if (cell.isInverse()) {
    if (cell.isBgRGB()) {
      const c = cell.getBgColor() & 0xffffff;
      return { color: `#${c.toString(16).padStart(6, "0")}` };
    }
    if (cell.isBgPalette()) {
      return { color: ansi256ToHex(cell.getBgColor()) };
    }
    return {};
  }
  if (cell.isFgRGB()) {
    const c = cell.getFgColor() & 0xffffff;
    return { color: `#${c.toString(16).padStart(6, "0")}` };
  }
  if (cell.isFgPalette()) {
    return { color: ansi256ToHex(cell.getFgColor()) };
  }
  return {};
}

function cellBgStyle(cell: IBufferCell): { backgroundColor?: string } {
  if (cell.isInverse()) {
    if (cell.isFgRGB()) {
      const c = cell.getFgColor() & 0xffffff;
      return { backgroundColor: `#${c.toString(16).padStart(6, "0")}` };
    }
    if (cell.isFgPalette()) {
      return { backgroundColor: ansi256ToHex(cell.getFgColor()) };
    }
    return {};
  }
  if (cell.isBgRGB()) {
    const c = cell.getBgColor() & 0xffffff;
    return { backgroundColor: `#${c.toString(16).padStart(6, "0")}` };
  }
  if (cell.isBgPalette()) {
    return { backgroundColor: ansi256ToHex(cell.getBgColor()) };
  }
  return {};
}

function renderLine(
  line: IBufferLine | undefined,
  cols: number,
  nullCell: IBufferCell,
  rowKey: number,
): ReactNode {
  if (!line) {
    return (
      <Text dimColor>
        {" ".repeat(cols)}
      </Text>
    );
  }

  const segments: ReactNode[] = [];
  let x = 0;
  let seg = 0;
  while (x < cols) {
    const cell = line.getCell(x, nullCell);
    if (!cell) {
      segments.push(
        <Text key={`${rowKey}-${seg++}`}> </Text>,
      );
      x += 1;
      continue;
    }
    const w = cell.getWidth();
    if (w === 0) {
      x += 1;
      continue;
    }

    const chars = cell.getChars() || " ";
    const fg = cellFgStyle(cell);
    const bg = cellBgStyle(cell);
    const bold = cell.isBold() !== 0;
    const underline = cell.isUnderline() !== 0;
    const italic = cell.isItalic() !== 0;
    const dim = cell.isDim() !== 0;

    segments.push(
      <Text
        key={`${rowKey}-${seg++}`}
        {...fg}
        {...bg}
        bold={bold}
        underline={underline}
        italic={italic}
        dimColor={dim}
      >
        {chars}
      </Text>,
    );

    x += w > 0 ? w : 1;
  }

  return <Text>{segments}</Text>;
}

export interface XtermViewportProps {
  term: Terminal;
  /** Bump to redraw when PTY output arrives. */
  renderVersion: number;
}

/** Renders the visible viewport of a headless xterm into Ink. */
export function XtermViewport({ term, renderVersion }: XtermViewportProps): ReactNode {
  void renderVersion;
  const buf = term.buffer.active;
  const start = buf.viewportY;
  const nullCell = buf.getNullCell();
  const rowEls: ReactNode[] = [];

  for (let r = 0; r < term.rows; r++) {
    const line = buf.getLine(start + r);
    rowEls.push(
      <Box key={r} height={1} width={term.cols}>
        {renderLine(line, term.cols, nullCell, r)}
      </Box>,
    );
  }

  return (
    <Box flexDirection="column" width={term.cols} height={term.rows}>
      {rowEls}
    </Box>
  );
}
