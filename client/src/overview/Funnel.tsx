import { useEffect, useState } from "react";
import type { FunnelResult } from "../lib/metrics";
import { statusColorVar } from "../lib/tracker";

/** Hand-rolled funnel bars — exact structure/animation technique from the
 *  mockup: bars start at width 0 and grow to their target % once mounted,
 *  triggering the CSS `width` transition. */
export function Funnel({ funnel }: { funnel: FunnelResult }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, [funnel]);

  const max = Math.max(1, ...funnel.stages.map((s) => s.count));

  return (
    <>
      <div className="fn">
        {funnel.stages.map((s) => {
          const targetPct = Math.max((s.count / max) * 100, s.count > 0 ? 1.5 : 0);
          return (
            <div className="fn-row" key={s.status}>
              <span className="n">{s.status}</span>
              <div className="fn-track">
                <div
                  className="fn-bar"
                  style={{
                    background: `var(${statusColorVar(s.status)})`,
                    opacity: s.count ? 0.85 : 0.25,
                    width: mounted ? `${targetPct}%` : 0,
                  }}
                />
              </div>
              <span className="v">{s.count}</span>
            </div>
          );
        })}
      </div>
      <div className="fn-exits">
        <span>
          exited rejected: <b>{funnel.rejected}</b>
        </span>
        <span>
          exited withdrawn: <b>{funnel.withdrawn}</b>
        </span>
      </div>
      <div className="foot-note">
        Counts are "reached this stage or beyond" (current status only, no history) — rejected/withdrawn
        applications are excluded from the bars since we can't tell which stage they exited from.
      </div>
    </>
  );
}
