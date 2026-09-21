import { useState } from "react";
import type { ApplyStatus } from "../../../shared/apply";
import { ApplicationDrawer } from "../application/ApplicationDrawer";
import { AssistantDock } from "../assistant/AssistantDock";
import { useAssistant } from "../assistant/AssistantProvider";
import { useJobHuntData } from "../data/JobHuntProvider";
import { IntakeView } from "../intake/IntakeView";
import { OverviewView } from "../overview/OverviewView";
import { PipelineView } from "../pipeline/PipelineView";
import { ScoutView } from "../scout/ScoutView";
import { NavRail } from "./NavRail";
import type { View } from "./types";

export function AppShell({ status }: { status: ApplyStatus }) {
  const [view, setView] = useState<View>("overview");
  const [drawerFolder, setDrawerFolder] = useState<string | null>(null);
  const { tracker } = useJobHuntData();
  const { cliFound } = useAssistant();

  const navigate = (v: View, folder?: string) => {
    setView(v);
    if (folder) setDrawerFolder(folder);
  };

  const rootLabel = status.root ? status.root.split(/[\\/]/).filter(Boolean).pop() : "job-hunt";

  return (
    <div className="frame">
      <div className="top">
        <div className="brand">
          Apply <span>Assistant</span>
        </div>
        <div className="top-right">
          <span
            className={`dot${cliFound ? "" : " off"}`}
            title={cliFound ? "claude CLI connected" : "claude CLI not found"}
          />
          <span className="kbd" style={{ border: "none", background: "none" }}>
            {rootLabel}
          </span>
        </div>
      </div>

      <div className="body">
        <NavRail active={view} onNavigate={(v) => navigate(v)} pipelineBadge={tracker.length} />

        <main className="canvas">
          {view === "overview" && <OverviewView onNavigate={navigate} />}
          {view === "pipeline" && <PipelineView onOpenDrawer={(f) => setDrawerFolder(f)} />}
          {view === "scout" && <ScoutView />}
          {view === "intake" && <IntakeView />}
        </main>

        <AssistantDock />
      </div>

      <ApplicationDrawer folder={drawerFolder} onClose={() => setDrawerFolder(null)} />
    </div>
  );
}
