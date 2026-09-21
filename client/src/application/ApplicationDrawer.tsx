import { useEffect, useRef, useState } from "react";
import type { ApplicationDetail } from "../../../shared/apply";
import { useJobHuntData } from "../data/JobHuntProvider";
import { fetchApplicationDetail, openInOsApp, pdfUrl } from "../lib/api";
import { copyToClipboard } from "../lib/clipboard";
import { cx } from "../lib/cx";
import { useFocusTrap } from "../lib/useFocusTrap";
import { findRowByFolder, statusColorVar } from "../lib/tracker";

function tierClass(confidence: string): string {
  if (confidence === "pattern-guessed") return "tier-pattern-guessed";
  if (confidence === "verified" || confidence === "public-listed") return "";
  return "tier-unknown";
}

function keywordPercent(detail: ApplicationDetail): number | null {
  if (detail.keywords.length === 0) return null;
  const score = detail.keywords.reduce((sum, k) => {
    if (k.presentLabel === "yes") return sum + 1;
    if (k.presentLabel === "partial") return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((score / detail.keywords.length) * 100);
}

export function ApplicationDrawer({ folder, onClose }: { folder: string | null; onClose: () => void }) {
  const { tracker } = useJobHuntData();
  const [detail, setDetail] = useState<ApplicationDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement>(null);
  const open = folder !== null;

  useFocusTrap(containerRef, open, onClose);

  useEffect(() => {
    if (!folder) {
      setDetail(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setActionNote(null);
    fetchApplicationDetail(folder)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folder]);

  const row = folder ? findRowByFolder(tracker, folder) : undefined;
  const kwPct = detail ? keywordPercent(detail) : null;

  const openDoc = (relName: string) => {
    if (!folder) return;
    openInOsApp(`applications/${folder}/${relName}`)
      .then(() => setActionNote(`Opened ${relName}`))
      .catch((err) => setActionNote(err instanceof Error ? err.message : String(err)));
  };

  const copyBody = (body: string) => {
    copyToClipboard(body)
      .then((ok) => setActionNote(ok ? "Draft body copied to clipboard." : "Copy failed."))
      .catch(() => setActionNote("Copy failed."));
  };

  const hasCvPdf = detail?.files.some((f) => f.name === "cv.pdf") ?? false;

  return (
    <>
      <div className={cx("scrim", open && "on")} onClick={onClose} />
      <aside
        ref={containerRef}
        className={cx("drawer", open && "on")}
        aria-label="Application detail"
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        {open && (
          <>
            <div className="dr-h" style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div>
                <h2 className="co" tabIndex={-1} style={{ margin: 0 }}>
                  {row?.company ?? folder}
                </h2>
                <div className="ro">
                  {row?.role}
                  {row?.location ? ` · ${row.location}` : ""}
                </div>
              </div>
              <button className="x" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>
            <div className="dr-b">
              {error && <div className="err-note">{error}</div>}
              {loading && !detail && <div className="load-note">Loading…</div>}

              {detail && (
                <>
                  <div className="kv">
                    <div>
                      <div className="l">Status</div>
                      <div className="v" style={{ color: `var(${statusColorVar(row?.status ?? "")})`, fontSize: 12 }}>
                        {row?.status ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="l">Contacts</div>
                      <div className="v">{detail.contacts.length}</div>
                    </div>
                    <div>
                      <div className="l">Drafts</div>
                      <div className="v">{detail.drafts.length}</div>
                    </div>
                  </div>

                  <div>
                    <p className="eyebrow">Documents</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {detail.files.length === 0 && <div className="empty">No files found.</div>}
                      {detail.files.map((f) => (
                        <div className="doc" key={f.name}>
                          <span className="ext">{f.ext.toUpperCase()}</span> {f.name}
                          <span className="ok">{(f.sizeBytes / 1024).toFixed(1)} kB</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {hasCvPdf && folder && (
                    <div>
                      <p className="eyebrow">CV preview</p>
                      <iframe
                        className="pdf-frame"
                        title="CV preview"
                        src={pdfUrl(`applications/${folder}/cv.pdf`)}
                      />
                    </div>
                  )}

                  <div>
                    <p className="eyebrow">Keyword match{kwPct !== null ? ` — ${kwPct}%` : ""}</p>
                    {detail.keywords.length === 0 ? (
                      <div className="empty">No keyword-match.md for this application.</div>
                    ) : (
                      <div className="chips">
                        {detail.keywords.map((k) => (
                          <span
                            key={k.keyword}
                            className={cx(
                              "chip",
                              k.presentLabel === "no" && "gap",
                              k.presentLabel === "partial" && "partial",
                            )}
                            title={k.note || undefined}
                          >
                            {k.presentLabel === "yes" ? "✓" : k.presentLabel === "partial" ? "~" : "✗"} {k.keyword}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="eyebrow">Contacts</p>
                    {detail.contacts.length === 0 ? (
                      <div className="empty">No contacts.md for this application.</div>
                    ) : (
                      detail.contacts.map((c, i) => (
                        <div className="ct-row" key={`${c.email}-${i}`}>
                          <span className="nm">{c.name}</span>
                          <span className={cx("tier", tierClass(c.confidence))}>{c.confidence || "unknown"}</span>
                          <span className="em">{c.email}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div>
                    <p className="eyebrow">Outreach drafts</p>
                    {detail.drafts.length === 0 ? (
                      <div className="empty">No outreach drafts.</div>
                    ) : (
                      detail.drafts.map((d) => (
                        <div className="draft" key={d.file}>
                          <div className="draft-h">
                            <span className="subj">{d.subject}</span>
                            <span className="to">{d.toName || d.to}</span>
                          </div>
                          <div className="draft-body">{d.body}</div>
                          <button className="btn" onClick={() => copyBody(d.body)}>
                            Copy body
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {detail.atsLint && (
                    <div>
                      <p className="eyebrow">ATS lint — {detail.atsLint.pass ? "PASS" : "FAIL"}</p>
                    </div>
                  )}

                  {actionNote && <div className="load-note">{actionNote}</div>}

                  <div style={{ display: "flex", gap: 7 }}>
                    <button className="btn pri" onClick={() => openDoc("cv.docx")}>
                      Open CV
                    </button>
                    <button className="btn" onClick={() => openDoc("letter.docx")}>
                      Open letter
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
