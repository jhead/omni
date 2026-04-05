import { describe, expect, test } from "bun:test";
import { createOmnimux } from "./index.ts";

describe("Omnimux", () => {
  test("spawns a short-lived shell command and captures output", async () => {
    const mux = createOmnimux();
    const s = mux.createSession({
      cmd: ["/bin/sh", "-c", 'printf "hello"'],
    });
    let out = "";
    s.onOutput((chunk) => {
      out += chunk;
    });
    const code = await s.exited;
    expect(code).toBe(0);
    expect(out).toContain("hello");
  });

  test("rule runs when plain tail matches", async () => {
    const mux = createOmnimux();
    const s = mux.createSession({
      cmd: ["/bin/sh", "-c", 'sleep 0.05; printf "Press enter to continue"'],
    });
    let saw = false;
    s.addRule({
      match: "Press enter",
      once: true,
      run: () => {
        saw = true;
      },
    });
    await s.exited;
    expect(saw).toBe(true);
  });
});
