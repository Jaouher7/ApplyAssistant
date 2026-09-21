import type { AttentionItem } from "../lib/metrics";

export function NeedsAttention({
  items,
  onSelect,
}: {
  items: AttentionItem[];
  onSelect: (item: AttentionItem) => void;
}) {
  if (items.length === 0) {
    return <div className="empty">Nothing needs attention right now.</div>;
  }
  return (
    <div className="att">
      {items.map((item) => (
        <button key={item.id} className={`att-item ${item.severity}`} onClick={() => onSelect(item)}>
          <div className="tx">
            {item.text} {item.emphasis && <em>{item.emphasis}</em>}
          </div>
          <span className="go">{item.actionLabel}</span>
        </button>
      ))}
    </div>
  );
}
