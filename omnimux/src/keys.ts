/**
 * Named keys for {@link TerminalSession.sendKey}. Values are bytes sent to the PTY.
 * @packageDocumentation
 */

/** Keys supported by {@link TerminalSession.sendKey}. */
export type KnownKey =
  | "Enter"
  | "Escape"
  | "Tab"
  | "Backspace"
  | "Delete"
  | "Up"
  | "Down"
  | "Left"
  | "Right"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "Ctrl+C"
  | "Ctrl+D"
  | "Ctrl+Z";

const KEY_SEQUENCES: Record<KnownKey, string> = {
  Enter: "\r",
  Escape: "\x1b",
  Tab: "\t",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  Up: "\x1b[A",
  Down: "\x1b[B",
  Right: "\x1b[C",
  Left: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  "Ctrl+C": "\x03",
  "Ctrl+D": "\x04",
  "Ctrl+Z": "\x1a",
};

/** Returns the PTY write payload for a named key. */
export function keyToSequence(key: KnownKey): string {
  return KEY_SEQUENCES[key];
}
