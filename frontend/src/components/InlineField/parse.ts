/** Parse a numeric draft exactly like the prototype: ',' → '.', NaN → 0, clamp to [min, max]. */
export function parseNumericDraft(draft: string, max: number, min = 0): number {
  const n = parseFloat(draft.replace(',', '.'));
  return Math.max(min, Math.min(max, Number.isNaN(n) ? 0 : n));
}
