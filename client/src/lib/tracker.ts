import type { TrackerRow, TrackerStatus } from "../../../shared/apply";

/** Ordered "reached at or beyond" stages — `tracker.csv` only stores the
 *  CURRENT status, so a funnel stage must count every application whose
 *  status is at or past that stage in this order, not just an exact match
 *  (otherwise an application at "interview" would wrongly show 0 at
 *  "replied"). `rejected`/`withdrawn` are terminal exits, deliberately not
 *  part of this ordering — see lib/funnel.ts. */
export const ACTIVE_STATUSES: readonly TrackerStatus[] = [
  "drafted",
  "contacted",
  "replied",
  "interview",
  "offer",
];

export const TERMINAL_STATUSES: readonly TrackerStatus[] = ["rejected", "withdrawn"];

export const ALL_STATUSES: readonly TrackerStatus[] = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES];

/** CSS custom property carrying this status's colour — `.status-*` classes
 *  aren't used here; components read `var(--s-<status>)` directly via
 *  inline style, same technique the mockup's `cv()` helper used. */
export function statusColorVar(status: string): string {
  return (ALL_STATUSES as readonly string[]).includes(status) ? `--s-${status}` : "--faint";
}

export function statusIndex(status: string): number {
  return ACTIVE_STATUSES.indexOf(status as TrackerStatus);
}

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** `application_folder` on disk is `applications\<slug>` (backslash) — key
 *  everything by basename and normalize separators, per plan §3.6.3. */
export function folderBasename(applicationFolder: string): string {
  const parts = applicationFolder.split(/[\\/]/);
  return parts[parts.length - 1] ?? applicationFolder;
}

export function findRowByFolder(rows: TrackerRow[], folder: string): TrackerRow | undefined {
  return rows.find((r) => folderBasename(r.application_folder) === folder);
}
