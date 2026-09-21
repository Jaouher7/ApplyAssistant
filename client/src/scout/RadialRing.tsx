/** Hand-rolled radial match-score ring — same `stroke-dasharray`/
 *  `stroke-dashoffset` technique as the mockup. `match === null` (a
 *  "partial listing" scout row with no score yet) renders a neutral dashed
 *  ring and a "–" label instead of "null%" or a broken/full ring. */
export function RadialRing({ match }: { match: number | null }) {
  const r = 22;
  const C = 2 * Math.PI * r;
  const known = match !== null;
  const color = !known ? "var(--faint)" : match >= 70 ? "var(--s-interview)" : match >= 58 ? "var(--s-contacted)" : "var(--dim)";
  const pct = known ? Math.max(0, Math.min(100, match)) : 0;

  return (
    <div className="ring" role="img" aria-label={known ? `Match score ${match}%` : "No match score"}>
      <svg width="52" height="52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--line)" strokeWidth={4} />
        {known ? (
          <circle
            cx="26"
            cy="26"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct / 100)}
          />
        ) : (
          <circle
            cx="26"
            cy="26"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeDasharray="3 5"
            strokeOpacity={0.6}
          />
        )}
      </svg>
      <span className="pct" style={{ color }}>
        {known ? match : "–"}
      </span>
    </div>
  );
}
