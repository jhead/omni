import { describe, expect, test } from "bun:test";

import { makePrefixedToolName, parsePrefixedToolName, prefixToolList } from "./aggregateTools";

describe("parsePrefixedToolName", () => {
  test("round-trip with longest-id match", () => {
    const sep = "__";
    const ids = new Set(["a", "ab", "ab-c"]);
    expect(parsePrefixedToolName("ab__tool", sep, ids)).toEqual({
      serverId: "ab",
      originalName: "tool",
    });
    expect(parsePrefixedToolName("ab-c__x", sep, ids)).toEqual({
      serverId: "ab-c",
      originalName: "x",
    });
  });

  test("makePrefixedToolName", () => {
    expect(makePrefixedToolName("srv", "t", "__")).toBe("srv__t");
  });
});

describe("prefixToolList", () => {
  test("dedupes collisions with suffix", () => {
    const used = new Set<string>();
    const schema = { type: "object" as const, properties: {} };
    const out = prefixToolList(
      "s",
      [
        { name: "x", inputSchema: schema },
        { name: "x", inputSchema: schema },
      ],
      "__",
      used,
    );
    expect(out.map(t => t.name)).toEqual(["s__x", "s__x__dup2"]);
  });
});
