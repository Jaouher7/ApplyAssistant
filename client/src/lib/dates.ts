/**
 * Date arithmetic for tracker/outbox/scout data — every entry point is
 * NaN-guarded (a hand-edited `YYYY-MM-DD` cell, or an ISO timestamp, can be
 * malformed) and returns `null` rather than `NaN`/`Invalid Date` on bad
 * input, matching the codebase-family gotcha already hit once
 * (`nan-slips-past-nullish-coalescing`).
 */

/** Parse a `YYYY-MM-DD` (or full ISO) date string into epoch ms, or null. */
export function parseDateMs(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Whole days between `s` and now (positive = in the past). Null when `s`
 *  is unparseable. */
export function daysSince(s: string | undefined | null): number | null {
  const t = parseDateMs(s);
  if (t === null) return null;
  const diff = Date.now() - t;
  return Number.isFinite(diff) ? Math.floor(diff / 86_400_000) : null;
}

/** Renders a day count as "Nd" (or "today"/"1d") — never "NaNd". */
export function formatAgeDays(days: number | null): string {
  if (days === null) return "—";
  if (days <= 0) return "today";
  return `${days}d`;
}

/**
 * Parse scout's `posted` column — relative French prose, e.g. "hier",
 * "aujourd'hui", "il y a 3 jours", "il y a 2 semaines". Returns null for
 * anything else (the caller falls back to showing the raw string), per
 * plan §3.6.10.
 */
export function parsePostedDays(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "aujourd'hui" || s === "aujourdhui") return 0;
  if (s === "hier") return 1;
  let m = /^il y a (\d+)\s*jours?$/.exec(s);
  if (m) return Number(m[1]);
  m = /^il y a (\d+)\s*semaines?$/.exec(s);
  if (m) return Number(m[1]) * 7;
  m = /^il y a (\d+)\s*mois$/.exec(s);
  if (m) return Number(m[1]) * 30;
  return null;
}
