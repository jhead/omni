/** @internal */
export function testMatch(match: string | RegExp, text: string): boolean {
  if (typeof match === "string") return text.includes(match);
  match.lastIndex = 0;
  return match.test(text);
}
