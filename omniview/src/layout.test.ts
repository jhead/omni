import { expect, test } from "bun:test";
import { computeGridLayout } from "./layout.ts";

test("computeGridLayout sizes panes for 2x2", () => {
  const L = computeGridLayout(4, 80, 24, 1);
  expect(L.gridCols).toBe(2);
  expect(L.gridRows).toBe(2);
  expect(L.panes.length).toBe(4);
  expect(L.panes[0]?.width).toBe(40);
  expect(L.panes[0]?.height).toBe(11);
});

test("computeGridLayout single pane uses space minus reserved rows", () => {
  const L = computeGridLayout(1, 100, 30, 1);
  expect(L.panes.length).toBe(1);
  expect(L.panes[0]?.width).toBe(100);
  expect(L.panes[0]?.height).toBe(29);
});
