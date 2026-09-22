import type { ScoutRow } from "../../../shared/apply";
import { useAssistant } from "../assistant/AssistantProvider";
import { useJobHuntData } from "../data/JobHuntProvider";
import { daysSince, parsePostedDays } from "../lib/dates";
import { RadialRing } from "./RadialRing";

// Defensive: only ever put a genuine absolute http(s) URL in an href. A
// relative-looking value would be resolved against the app's own origin and
// bounce the user back into the SPA instead of opening the posting.
function isHttpUrl(v: string | null | undefined): v is string {
  return !!v && /^https?:\/\//i.test(v);
}

function ScoutCard({ row }: { row: ScoutRow }) {
  const days = parsePostedDays(row.posted);
  const fresh = days !== null && days <= 2;
  return (
    <article className="sc">
      <RadialRing match={row.match} />
      <div className="sc-b">
        <div className="co">{row.company}</div>
        <div className="ro">{row.role}</div>
        <div className="chips">
          {row.keyMatches.map((k, i) => (
            <span className="chip" key={`hit-${i}`}>
              {k}
            </span>
          ))}
          {row.gaps.map((g, i) => (
            <span className="chip gap" key={`gap-${i}`}>
              {g}
            </span>
          ))}
        </div>
        <div className="sc-f">
          <span className={`age${fresh ? " fresh" : ""}`}>▲ {row.posted}</span>
          {row.queued && <span className="btn on">✓ queued</span>}
          {isHttpUrl(row.sourceUrl) && (
            <a className="btn pri" style={{ marginLeft: "auto" }} href={row.sourceUrl} target="_blank" rel="noreferrer">
              Open posting
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function ScoutView() {
  const { scout, loading, error } = useJobHuntData();
  const { runScout, busy, configured } = useAssistant();

  const sweepDays = daysSince(scout?.updated ?? null);
  const sub = scout?.found
    ? `swept ${scout?.updated ? new Date(scout.updated).toLocaleDateString() : "?"}${
        sweepDays !== null ? ` (${sweepDays}d ago)` : ""
      }`
    : "no sweep run yet";

  return (
    <section className="view" id="v-scout">
      <div className="h">
        <h2>Scout</h2>
        <span className="sub">{sub}</span>
        <span className="sp" />
        <button className="btn pri" disabled={!configured || busy} onClick={runScout}>
          {busy ? "Running…" : "Run sweep"}
        </button>
      </div>

      {error && <div className="err-note">{error}</div>}
      {loading && !scout && <div className="load-note">Loading…</div>}

      {scout && !scout.found && (
        <div className="empty" style={{ maxWidth: 480 }}>
          No scout sweep has been run yet. Use "Run sweep" to have the assistant scan job boards for new offers.
        </div>
      )}

      {scout && scout.found && (
        <div className="scout">
          {scout.rows.map((row, i) => (
            <ScoutCard key={`${row.company}-${i}`} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}
