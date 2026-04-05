/**
 * Compute an N-pane grid inside the terminal character cell, minus reserved rows (e.g. status bar).
 */

export interface PaneRect {
  /** Column index in the grid (0-based). */
  col: number;
  /** Row index in the grid (0-based). */
  row: number;
  /** Width in character cells. */
  width: number;
  /** Height in character cells (including any in-pane chrome the caller subtracts). */
  height: number;
}

export interface GridLayout {
  gridCols: number;
  gridRows: number;
  panes: PaneRect[];
}

/**
 * @param paneCount Number of sessions to tile
 * @param windowCols Host terminal width (columns)
 * @param windowRows Host terminal height (rows)
 * @param reservedRows Rows reserved outside the grid (e.g. global status line)
 */
export function computeGridLayout(
  paneCount: number,
  windowCols: number,
  windowRows: number,
  reservedRows: number,
): GridLayout {
  if (paneCount <= 0) {
    return { gridCols: 1, gridRows: 1, panes: [] };
  }

  const usableRows = Math.max(1, windowRows - reservedRows);
  const gridCols = Math.ceil(Math.sqrt(paneCount));
  const gridRows = Math.ceil(paneCount / gridCols);

  const paneWidth = Math.max(1, Math.floor(windowCols / gridCols));
  const paneHeight = Math.max(1, Math.floor(usableRows / gridRows));

  const panes: PaneRect[] = [];
  for (let i = 0; i < paneCount; i++) {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    panes.push({ col, row, width: paneWidth, height: paneHeight });
  }

  return { gridCols, gridRows, panes };
}
