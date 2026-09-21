import type { View } from "./types";

const ITEMS: { view: View; icon: string; title: string }[] = [
  { view: "overview", icon: "◧", title: "Overview" },
  { view: "pipeline", icon: "▤", title: "Pipeline" },
  { view: "scout", icon: "◎", title: "Scout" },
  { view: "intake", icon: "⇧", title: "Intake" },
];

export function NavRail({
  active,
  onNavigate,
  pipelineBadge,
}: {
  active: View;
  onNavigate: (view: View) => void;
  pipelineBadge: number;
}) {
  return (
    <nav className="rail" aria-label="Views">
      {ITEMS.map((item) => (
        <button
          key={item.view}
          data-v={item.view}
          aria-current={active === item.view ? "page" : undefined}
          title={item.title}
          onClick={() => onNavigate(item.view)}
        >
          <span>{item.icon}</span>
          {item.view === "pipeline" && pipelineBadge > 0 && <span className="badge">{pipelineBadge}</span>}
        </button>
      ))}
    </nav>
  );
}
