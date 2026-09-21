import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { OutboxItem, ScoutResponse, TrackerRow } from "../../../shared/apply";
import { fetchOutbox, fetchScout, fetchTracker, patchTrackerStatus } from "../lib/api";
import { folderBasename } from "../lib/tracker";

/**
 * Owns the three shared read resources (tracker/outbox/scout) plus the one
 * write path this UI exposes (tracker status). Refetches wholesale on
 * window focus and after any chat `turn-complete` (wired by the caller,
 * since the WS lives in AssistantProvider) — no polling loop, no partial
 * cache invalidation, matching the plan's stance that the filesystem is the
 * single source of truth and a full refetch is cheap enough here.
 */

interface JobHuntDataValue {
  configured: boolean;
  tracker: TrackerRow[];
  outbox: OutboxItem[];
  scout: ScoutResponse | undefined;
  loading: boolean;
  error: string | null;
  refreshAll: () => void;
  /** Optimistic update, rollback on failure. Throws on failure so the
   *  caller can surface the message; the caller is responsible for any
   *  UI-local "reverted" messaging beyond that. */
  patchStatus: (folder: string, nextStatus: string) => Promise<void>;
}

const JobHuntDataContext = createContext<JobHuntDataValue | null>(null);

export function useJobHuntData(): JobHuntDataValue {
  const ctx = useContext(JobHuntDataContext);
  if (!ctx) throw new Error("useJobHuntData() must be used inside <JobHuntProvider>");
  return ctx;
}

export function JobHuntProvider({ configured, children }: { configured: boolean; children: ReactNode }) {
  const [tracker, setTracker] = useState<TrackerRow[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [scout, setScout] = useState<ScoutResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([fetchTracker(), fetchOutbox(), fetchScout()])
      .then(([t, o, s]) => {
        setTracker(t.rows);
        setOutbox(o.items);
        setScout(s);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [configured]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Refetch on window focus — the data on disk changes underneath the app
  // whenever a CLI turn runs elsewhere (another tab, a manual edit).
  useEffect(() => {
    if (!configured) return;
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [configured, reload]);

  const patchStatus = useCallback(
    async (folder: string, nextStatus: string) => {
      const idx = tracker.findIndex((r) => folderBasename(r.application_folder) === folder);
      if (idx === -1) throw new Error(`No tracker row found for "${folder}"`);
      const prev = tracker;
      const optimistic = [...tracker];
      optimistic[idx] = { ...optimistic[idx], status: nextStatus };
      setTracker(optimistic);
      try {
        await patchTrackerStatus(folder, nextStatus);
        reload();
      } catch (err) {
        setTracker(prev);
        throw err;
      }
    },
    [tracker, reload],
  );

  const value = useMemo<JobHuntDataValue>(
    () => ({ configured, tracker, outbox, scout, loading, error, refreshAll: reload, patchStatus }),
    [configured, tracker, outbox, scout, loading, error, reload, patchStatus],
  );

  return <JobHuntDataContext.Provider value={value}>{children}</JobHuntDataContext.Provider>;
}
