import { describe, expect, test } from "bun:test";

import { validateOmnitoolRegistry } from "./validateRegistry";

describe("validateOmnitoolRegistry", () => {
  test("accepts minimal config", () => {
    const r = validateOmnitoolRegistry({
      listen: { hostname: "127.0.0.1", port: 9000 },
      mcpPath: "/mcp",
      toolPrefixSeparator: "__",
      servers: [],
    });
    expect(r.servers).toEqual([]);
  });

  test("rejects duplicate ids", () => {
    expect(() =>
      validateOmnitoolRegistry({
        listen: { hostname: "127.0.0.1", port: 9000 },
        mcpPath: "/mcp",
        servers: [
          { id: "a", type: "stdio", stdio: { command: "echo" } },
          { id: "a", type: "stdio", stdio: { command: "echo" } },
        ],
      }),
    ).toThrow(/Duplicate backend id/);
  });
});
