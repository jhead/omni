/** Deep-merge plain objects; arrays and scalars from `b` replace `a`. */
export function deepMergeJson(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue
    const existing = out[k]
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[k] = deepMergeJson(existing as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}
