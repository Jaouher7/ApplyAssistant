import { useRef, useState } from "react";
import type { ApplyClassification, CvImportResult, JdWriteResult, UploadResult } from "../../../shared/apply";
import { uploadPdf, writeCvImport, writeJd } from "../lib/api";
import { cx } from "../lib/cx";

/**
 * Drag/drop + <input type=file> fallback → POST /api/apply/upload
 * (multipart) → shows classification + confidence + matched signals → user
 * confirms/overrides cv-vs-job_posting → confirm routes to POST
 * /api/apply/jd (job posting, editable company/roleTitle/sourceUrl,
 * pre-filled from `suggested`) or POST /api/apply/cv-import (CV) → shows the
 * written path, or the 409/400 error clearly. Restyled onto the new design
 * tokens; the fetch/classify/route behavior itself is unchanged from the
 * pre-overhaul `components/apply/PdfDropZone.tsx`.
 */

interface PdfDropZoneProps {
  configured: boolean;
  /** Lifts the last successful JD write up so the assistant dock's
   *  "Run pipeline" quick action can use it. */
  onJdWritten: (absPath: string, relPath: string) => void;
}

type RoutedResult = { kind: "jd"; result: JdWriteResult } | { kind: "cv"; result: CvImportResult };

export function PdfDropZone({ configured, onJdWritten }: PdfDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [upload, setUpload] = useState<UploadResult>();
  const [classification, setClassification] = useState<Exclude<ApplyClassification, "ambiguous">>();
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [routing, setRouting] = useState(false);
  const [routed, setRouted] = useState<RoutedResult>();

  const reset = () => {
    setUpload(undefined);
    setClassification(undefined);
    setCompany("");
    setRoleTitle("");
    setSourceUrl("");
    setRouted(undefined);
    setError(undefined);
  };

  const handleFile = async (file: File) => {
    reset();
    setUploading(true);
    try {
      const result = await uploadPdf(file);
      setUpload(result);
      setClassification(result.classification === "ambiguous" ? "job_posting" : result.classification);
      setCompany(result.suggested.company);
      setRoleTitle(result.suggested.roleTitle);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!configured) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const confirm = async () => {
    if (!upload || !classification) return;
    setRouting(true);
    setError(undefined);
    try {
      if (classification === "cv") {
        const result = await writeCvImport(upload.text);
        setRouted({ kind: "cv", result });
      } else {
        if (!company.trim() || !roleTitle.trim()) {
          setError("Company and role title are required.");
          return;
        }
        const result = await writeJd({
          company: company.trim(),
          roleTitle: roleTitle.trim(),
          sourceUrl: sourceUrl.trim(),
          text: upload.text,
        });
        setRouted({ kind: "jd", result });
        onJdWritten(result.absPath, result.relPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRouting(false);
    }
  };

  return (
    <div className="intake-grid">
      <div
        className={cx("dropzone", dragging && "active", !configured && "disabled")}
        onDragOver={(e) => {
          e.preventDefault();
          if (configured) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => configured && inputRef.current?.click()}
        role="button"
        tabIndex={configured ? 0 : -1}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && configured) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          disabled={!configured}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        {uploading ? "Extracting…" : "Drop a PDF here, or click to choose a file"}
      </div>

      {error && <div className="err-note">{error}</div>}

      {upload && !routed && (
        <div className="classify-card">
          <div className="classify-row">
            <span style={{ color: "var(--dim)" }}>Detected:</span>
            <span className="mono" style={{ fontFamily: "var(--font-mono)" }}>
              {upload.classification}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--dim)" }}>
              confidence {(upload.confidence * 100).toFixed(0)}%
            </span>
          </div>
          {(upload.signals.cv.length > 0 || upload.signals.jobPosting.length > 0) && (
            <div className="classify-signals">
              {upload.signals.cv.length > 0 && <div>CV signals: {upload.signals.cv.join(", ")}</div>}
              {upload.signals.jobPosting.length > 0 && (
                <div>Job posting signals: {upload.signals.jobPosting.join(", ")}</div>
              )}
            </div>
          )}

          <div className="toggle-row">
            <span style={{ fontSize: 12, color: "var(--dim)", marginRight: 4 }}>Route as</span>
            <button
              className={cx("toggle-btn", classification === "job_posting" && "on")}
              onClick={() => setClassification("job_posting")}
            >
              Job posting
            </button>
            <button className={cx("toggle-btn", classification === "cv" && "on")} onClick={() => setClassification("cv")}>
              CV
            </button>
          </div>

          {classification === "job_posting" && (
            <div className="field-list">
              <label className="field">
                <span>Company</span>
                <input value={company} onChange={(e) => setCompany(e.target.value)} />
              </label>
              <label className="field">
                <span>Role title</span>
                <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
              </label>
              <label className="field">
                <span>Source URL (optional)</span>
                <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
              </label>
            </div>
          )}

          <button className="btn pri" disabled={routing} onClick={() => void confirm()}>
            {routing ? "Saving…" : classification === "cv" ? "Save as pending CV import" : "Save job posting"}
          </button>
        </div>
      )}

      {routed && (
        <div className="routed-row">
          Saved to <code>{routed.result.relPath}</code>
          <button className="btn" onClick={reset}>
            Upload another
          </button>
        </div>
      )}
    </div>
  );
}
