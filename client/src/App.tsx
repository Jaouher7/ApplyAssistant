import { useEffect, useState } from "react";
import type { ApplyStatus } from "../../shared/apply";
import { AssistantProvider } from "./assistant/AssistantProvider";
import { JobHuntProvider, useJobHuntData } from "./data/JobHuntProvider";
import { fetchStatus } from "./lib/api";
import { ConfigGate } from "./shell/ConfigGate";
import { AppShell } from "./shell/AppShell";

/** Bridges JobHuntProvider's `refreshAll` into AssistantProvider's
 *  `onTurnComplete` — the cheap, correct "the CLI just ran, the filesystem
 *  probably changed" trigger the plan calls for. Lives inside
 *  <JobHuntProvider> so it can read the context; wraps everything the
 *  assistant needs to be mounted once at shell level. */
function AssistantBridge({ status, children }: { status: ApplyStatus; children: React.ReactNode }) {
  const { refreshAll } = useJobHuntData();
  return (
    <AssistantProvider
      root={status.root}
      cliFound={status.cliFound}
      configured={status.jobHuntConfigured}
      onTurnComplete={refreshAll}
    >
      {children}
    </AssistantProvider>
  );
}

export default function App() {
  const [status, setStatus] = useState<ApplyStatus>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch(() => setStatus({ jobHuntConfigured: false, root: "", cliFound: false }))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !status) {
    return (
      <div className="frame">
        <div className="empty-panel">Loading Apply Assistant…</div>
      </div>
    );
  }

  return (
    <JobHuntProvider configured={status.jobHuntConfigured}>
      <AssistantBridge status={status}>
        {status.jobHuntConfigured ? (
          <AppShell status={status} />
        ) : (
          <div className="frame">
            <ConfigGate />
          </div>
        )}
      </AssistantBridge>
    </JobHuntProvider>
  );
}
