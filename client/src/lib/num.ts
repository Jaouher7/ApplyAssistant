/** Number.isFinite-guarded numeric helpers — a hand-edited CSV/markdown
 *  cell can be empty or garbage; `Number(x) || 0` silently swallows that
 *  as 0 instead of surfacing "unknown". */

export function toIntOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Formats a 0..1 ratio as a percent string, or "—" when the denominator
 *  was 0 (never "NaN%"/"0%" for a not-yet-meaningful rate). */
export function pctOrDash(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}
