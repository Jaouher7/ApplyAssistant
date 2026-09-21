import { useState } from "react";
import type { TrackerRow } from "../../../shared/apply";
import { useJobHuntData } from "../data/JobHuntProvider";
import { cx } from "../lib/cx";
import { ACTIVE_STATUSES, folderBasename, statusColorVar } from "../lib/tracker";
import { ApplicationCard } from "./ApplicationCard";

interface StatusColumnProps {
  status: string;
  rows: TrackerRow[];
  dragOver: boolean;
  onDragOverColumn: () => void;
  onDragLeaveColumn: () => void;
  onDropColumn: (folder: string) => void;
  onOpen: (folder: string) => void;
  onStatusChange: (folder: string, next: string) => void;
  draggingFolder: string | null;
  onDragStart: (folder: string) => void;
  onDragEnd: () => void;
}

function StatusColumn({
  status,
  rows,
  dragOver,
  onDragOverColumn,
  onDragLeaveColumn,
  onDropColumn,
  onOpen,
  onStatusChange,
  draggingFolder,
  onDragStart,
  onDragEnd,
}: StatusColumnProps) {
  return (
    <div
      className={cx("col", dragOver && "drop-hover")}
      role="list"
      aria-label={`${status}, ${rows.length} application${rows.length === 1 ? "" : "s"}`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverColumn();
      }}
      onDragLeave={onDragLeaveColumn}
      onDrop={(e) => {
        e.preventDefault();
        const folder = e.dataTransfer.getData("text/plain");
        if (folder) onDropColumn(folder);
      }}
    >
      <div className="col-h">
        <span className="sw" style={{ background: `var(${statusColorVar(status)})` }} />
        {status}
        <span className="ct">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">—</div>
      ) : (
        rows.map((row) => (
          <ApplicationCard
            key={row.application_folder}
            row={row}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            dragging={draggingFolder === folderBasename(row.application_folder)}
          />
        ))
      )}
    </div>
  );
}

export function PipelineView({ onOpenDrawer }: { onOpenDrawer: (folder: string) => void }) {
  const { tracker, loading, error: dataError, patchStatus } = useJobHuntData();
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const byStatus = new Map<string, TrackerRow[]>();
  for (const status of ACTIVE_STATUSES) byStatus.set(status, []);
  const archived: TrackerRow[] = [];
  for (const row of tracker) {
    if ((ACTIVE_STATUSES as readonly string[]).includes(row.status)) {
      byStatus.get(row.status)!.push(row);
    } else {
      archived.push(row); // rejected / withdrawn / any unrecognized status
    }
  }

  const changeStatus = (folder: string, next: string) => {
    setActionError(null);
    patchStatus(folder, next).catch((err) => {
      setActionError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <section className="view" id="v-pipeline">
      <div className="h">
        <h2>Pipeline</h2>
        <span className="sub">drag a card, or use its status menu · writes to tracker.csv</span>
      </div>

      {dataError && <div className="err-note">{dataError}</div>}
      {actionError && (
        <div className="err-note" onClick={() => setActionError(null)} role="button" tabIndex={0}>
          {actionError} (dismiss)
        </div>
      )}
      {loading && tracker.length === 0 && <div className="load-note">Loading…</div>}

      <div className="board">
        {ACTIVE_STATUSES.map((status) => (
          <StatusColumn
            key={status}
            status={status}
            rows={byStatus.get(status) ?? []}
            dragOver={dragOverStatus === status}
            onDragOverColumn={() => setDragOverStatus(status)}
            onDragLeaveColumn={() => setDragOverStatus((s) => (s === status ? null : s))}
            onDropColumn={(folder) => {
              setDragOverStatus(null);
              setDraggingFolder(null);
              changeStatus(folder, status);
            }}
            onOpen={onOpenDrawer}
            onStatusChange={changeStatus}
            draggingFolder={draggingFolder}
            onDragStart={setDraggingFolder}
            onDragEnd={() => setDraggingFolder(null)}
          />
        ))}
      </div>

      <button className="archive-toggle" onClick={() => setArchiveOpen((v) => !v)} aria-expanded={archiveOpen}>
        {archiveOpen ? "Hide" : "Show"} Archive ({archived.length})
      </button>
      {archiveOpen && (
        <div className="archive-list">
          {archived.length === 0 && <div className="empty">No rejected/withdrawn applications.</div>}
          {archived.map((row) => (
            <button
              key={row.application_folder}
              className="archive-row"
              onClick={() => onOpenDrawer(folderBasename(row.application_folder))}
            >
              <span>{row.company}</span>
              <span style={{ color: "var(--dim)" }}>{row.role}</span>
              <span className="st" style={{ color: `var(${statusColorVar(row.status)})` }}>
                {row.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
