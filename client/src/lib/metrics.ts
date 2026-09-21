import type { OutboxItem, ScoutRow, TrackerRow } from "../../../shared/apply";
import { daysSince, parsePostedDays } from "./dates";
import { ACTIVE_STATUSES, folderBasename, isTerminalStatus, statusIndex } from "./tracker";

export interface FunnelStage {
  status: string;
  count: number;
}

export interface FunnelResult {
  stages: FunnelStage[];
  rejected: number;
  withdrawn: number;
}

/** "At or beyond stage N" over drafted<contacted<replied<interview<offer.
 *  rejected/withdrawn are excluded from the stage bars (we don't know which
 *  stage they exited from) and reported as separate exit counters. */
export function computeFunnel(rows: TrackerRow[]): FunnelResult {
  const stages: FunnelStage[] = ACTIVE_STATUSES.map((status, i) => ({
    status,
    count: rows.filter((r) => {
      const idx = statusIndex(r.status);
      return idx >= i; // excludes terminal statuses (statusIndex === -1)
    }).length,
  }));
  return {
    stages,
    rejected: rows.filter((r) => r.status === "rejected").length,
    withdrawn: rows.filter((r) => r.status === "withdrawn").length,
  };
}

export interface Kpis {
  applications: number;
  inFlight: number;
  draftsToReview: number;
  oldestDraftDays: number | null;
  responseRateLabel: string;
  scoutMatches: number;
  scoutSweepDays: number | null;
}

export function computeKpis(
  rows: TrackerRow[],
  outbox: OutboxItem[],
  scoutRows: ScoutRow[],
  scoutUpdatedIso: string | null,
): Kpis {
  const funnel = computeFunnel(rows);
  const contactedOrBeyond = funnel.stages[1]?.count ?? 0; // index 1 = contacted
  const repliedOrBeyond = funnel.stages[2]?.count ?? 0; // index 2 = replied
  const inFlight = rows.filter((r) => ["contacted", "replied", "interview"].includes(r.status)).length;

  const pending = outbox.filter((o) => !o.reviewed);
  const oldestDraftAge = pending
    .map((o) => daysSince(o.date))
    .filter((d): d is number => d !== null)
    .sort((a, b) => b - a)[0];

  const scoutMatches = scoutRows.filter((r) => {
    const d = parsePostedDays(r.posted);
    return d !== null && d <= 7;
  }).length;

  return {
    applications: rows.length,
    inFlight,
    draftsToReview: pending.length,
    oldestDraftDays: oldestDraftAge ?? null,
    responseRateLabel:
      contactedOrBeyond <= 0 ? "—" : `${Math.round((repliedOrBeyond / contactedOrBeyond) * 100)}%`,
    scoutMatches,
    scoutSweepDays: daysSince(scoutUpdatedIso),
  };
}

export type AttentionSeverity = "due" | "warn" | "info";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  text: string;
  emphasis?: string;
  actionLabel: string;
  view: "pipeline" | "scout";
  targetFolder?: string;
}

const FOLLOWUP_IDLE_DAYS = 7;

export function computeNeedsAttention(
  rows: TrackerRow[],
  outbox: OutboxItem[],
  scoutUpdatedIso: string | null,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  // 1. Unreviewed outreach drafts, grouped by company (a company can have
  // several draft recipients, e.g. one application with 3 contacts).
  const pendingByCompany = new Map<string, { count: number; oldestDays: number | null; folder?: string }>();
  for (const o of outbox) {
    if (o.reviewed) continue;
    const days = daysSince(o.date);
    const existing = pendingByCompany.get(o.company);
    const folder = folderBasename(o.draftPath.split(/[\\/]/).slice(0, -2).join("/") || "");
    if (existing) {
      existing.count += 1;
      if (days !== null && (existing.oldestDays === null || days > existing.oldestDays)) {
        existing.oldestDays = days;
      }
    } else {
      pendingByCompany.set(o.company, { count: 1, oldestDays: days, folder });
    }
  }
  for (const [company, info] of pendingByCompany) {
    const ageText = info.oldestDays !== null ? `, ${info.oldestDays} days old` : "";
    items.push({
      id: `draft-${company}`,
      severity: "due",
      text: `${info.count} outreach draft${info.count === 1 ? "" : "s"} unsent`,
      emphasis: `— ${company}${ageText}`,
      actionLabel: "Review →",
      view: "pipeline",
      targetFolder: info.folder,
    });
  }

  // 2. Applications sitting in "contacted" with last_updated older than 7
  // days — a follow-up nudge (copy the draft and send it yourself, never
  // "send").
  for (const row of rows) {
    if (row.status !== "contacted") continue;
    const idle = daysSince(row.last_updated);
    if (idle === null || idle <= FOLLOWUP_IDLE_DAYS) continue;
    items.push({
      id: `followup-${row.application_folder}`,
      severity: "warn",
      text: `${row.company} awaiting follow-up`,
      emphasis: `— contacted ${idle} days ago`,
      actionLabel: "Open →",
      view: "pipeline",
      targetFolder: folderBasename(row.application_folder),
    });
  }

  // 3. Scout freshness.
  const sweepDays = daysSince(scoutUpdatedIso);
  if (sweepDays !== null) {
    items.push({
      id: "scout-sweep",
      severity: "info",
      text: `Scout last swept ${sweepDays} day${sweepDays === 1 ? "" : "s"} ago`,
      actionLabel: "Sweep →",
      view: "scout",
    });
  } else if (rows.length > 0) {
    items.push({
      id: "scout-sweep-never",
      severity: "info",
      text: "Scout has not been swept yet",
      actionLabel: "Sweep →",
      view: "scout",
    });
  }

  return items;
}

export { isTerminalStatus };
