/**
 * Map ANSI 256-color palette index to #RRGGBB (xterm).
 */

function cube6(n: number): number {
  if (n === 0) return 0;
  return 55 + (n - 1) * 40;
}

/** Standard VGA / xterm colors 0–15. */
const BASE16: readonly string[] = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];

export function ansi256ToHex(index: number): string {
  const i = Math.max(0, Math.min(255, Math.floor(index)));
  if (i < 16) {
    return BASE16[i] ?? "#000000";
  }
  if (i < 232) {
    const n = i - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    const R = cube6(r);
    const G = cube6(g);
    const B = cube6(b);
    const hex = (x: number) => x.toString(16).padStart(2, "0");
    return `#${hex(R)}${hex(G)}${hex(B)}`;
  }
  const grey = 8 + (i - 232) * 10;
  const h = grey.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}
