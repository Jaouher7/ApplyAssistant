import type { TrackerRow } from "../../../shared/apply";
import { daysSince, formatAgeDays } from "../lib/dates";
import { toIntOrNull } from "../lib/num";
import { ALL_STATUSES, folderBasename, statusColorVar } from "../lib/tracker";

interface ApplicationCardProps {
  row: TrackerRow;
  onOpen: (folder: string) => void;
  onStatusChange: (folder: string, nextStatus: string) => void;
  onDragStart: (folder: string) => void;
  onDragEnd: () => void;
  dragging: boolean;
}

/** One Kanban card. Two independent ways to change status — native HTML5
 *  drag (mouse) and this card's own `<select>` (keyboard/assistive tech;
 *  also the only path on the narrow layout where the board collapses). */
export function ApplicationCard({ row, onOpen, onStatusChange, onDragStart, onDragEnd, dragging }: ApplicationCardProps) {
  const folder = folderBasename(row.application_folder);
  const contacts = toIntOrNull(row.contacts_found);
  const age = formatAgeDays(daysSince(row.date_added));

  return (
    <article
      className={`jc${dragging ? " dragging" : ""}`}
      style={{ borderLeftColor: `var(${statusColorVar(row.status)})` }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", folder);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(folder);
      }}
      onDragEnd={onDragEnd}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(folder)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(folder);
          }
        }}
      >
        <div className="co">{row.company}</div>
        <div className="ro">{row.role}</div>
        <div className="jc-f">
          <span>{contacts !== null ? `${contacts} contacts` : "— contacts"}</span>
          <span style={{ marginLeft: "auto" }}>{age}</span>
        </div>
      </div>
      <select
        className="jc-status-select"
        aria-label={`Change status for ${row.company}`}
        value={row.status}
        onChange={(e) => onStatusChange(folder, e.target.value)}
      >
        {!(ALL_STATUSES as readonly string[]).includes(row.status) && (
          <option value={row.status}>{row.status} (unrecognized)</option>
        )}
        {ALL_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </article>
  );
}
