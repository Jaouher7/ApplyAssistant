import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal fetch + loading/error/reload hook — replaces a query library per
 * the no-new-deps constraint. One consumer per resource in this app, one
 * source of truth (the job-hunt filesystem), so all we need is "fetch on
 * mount/dep-change" + "expose a manual reload" + "abort a stale in-flight
 * request when a newer one starts."
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const gen = useRef(0);

  const load = useCallback(() => {
    const myGen = ++gen.current;
    setLoading(true);
    fetcher()
      .then((result) => {
        if (gen.current !== myGen) return; // superseded by a newer call
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (gen.current !== myGen) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (gen.current !== myGen) return;
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, error, loading, reload: load };
}
