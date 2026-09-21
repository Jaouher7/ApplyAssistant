import { useJobHuntData } from "../data/JobHuntProvider";
import { computeFunnel, computeKpis, computeNeedsAttention, type AttentionItem } from "../lib/metrics";
import { Funnel } from "./Funnel";
import { NeedsAttention } from "./NeedsAttention";

interface OverviewViewProps {
  onNavigate: (view: "pipeline" | "scout", folder?: string) => void;
}

export function OverviewView({ onNavigate }: OverviewViewProps) {
  const { tracker, outbox, scout, loading, error } = useJobHuntData();

  const scoutRows = scout?.rows ?? [];
  const kpis = computeKpis(tracker, outbox, scoutRows, scout?.updated ?? null);
  const funnel = computeFunnel(tracker);
  const attention = computeNeedsAttention(tracker, outbox, scout?.updated ?? null);

  const pendingDrafts = outbox.filter((o) => !o.reviewed).length;
  const sub =
    tracker.length === 0
      ? "no applications yet"
      : `${tracker.length} application${tracker.length === 1 ? "" : "s"} · ${pendingDrafts} draft${
          pendingDrafts === 1 ? "" : "s"
        } pending`;

  const onSelectAttention = (item: AttentionItem) => onNavigate(item.view, item.targetFolder);

  return (
    <section className="view" id="v-overview">
      <div className="h">
        <h2>Overview</h2>
        <span className="sub">{sub}</span>
      </div>

      {error && <div className="err-note">{error}</div>}
      {loading && tracker.length === 0 && <div className="load-note">Loading…</div>}

      <div className="kpis">
        <div className="kpi">
          <div className="lab">Applications</div>
          <div className="val">{kpis.applications}</div>
          <div className="delta">tracked total</div>
        </div>
        <div className="kpi">
          <div className="lab">In flight</div>
          <div className="val">{kpis.inFlight}</div>
          <div className="delta">contacted / replied / interview</div>
        </div>
        <div className={`kpi ${kpis.draftsToReview > 0 ? "attn" : ""}`}>
          <div className="lab">Drafts to review</div>
          <div className="val">{kpis.draftsToReview}</div>
          <div className="delta">
            {kpis.oldestDraftDays !== null ? `oldest ${kpis.oldestDraftDays}d` : "none pending"}
          </div>
        </div>
        <div className="kpi">
          <div className="lab">Response rate</div>
          <div className="val">{kpis.responseRateLabel}</div>
          <div className="delta">replied+ / contacted+</div>
        </div>
        <div className="kpi">
          <div className="lab">Scout matches</div>
          <div className="val">{kpis.scoutMatches}</div>
          <div className="delta">
            {kpis.scoutSweepDays !== null ? `swept ${kpis.scoutSweepDays}d ago` : "not swept yet"}
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Pipeline funnel</h3>
          <Funnel funnel={funnel} />
        </div>
        <div className="card">
          <h3>Needs attention</h3>
          <NeedsAttention items={attention} onSelect={onSelectAttention} />
        </div>
      </div>
    </section>
  );
}
