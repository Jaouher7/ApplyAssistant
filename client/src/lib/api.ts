import type {
  ApplicationDetail,
  ApplyStatus,
  CvImportResult,
  JdWriteResult,
  OutboxResponse,
  ScoutResponse,
  TrackerResponse,
  UploadResult,
} from "../../../shared/apply";

/**
 * One typed function per `/api/apply/*` route — every fetch in the app goes
 * through here rather than ad-hoc inline `fetch()` calls, so the route
 * paths/shapes live in exactly one place. No route is added or renamed;
 * this only wraps the routes that already exist in server/src/index.ts.
 */

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body && body.error) || `${url} failed (${res.status})`);
  }
  return body as T;
}

export function fetchStatus(): Promise<ApplyStatus> {
  return getJson<ApplyStatus>("/api/apply/status");
}

export function fetchTracker(): Promise<TrackerResponse> {
  return getJson<TrackerResponse>("/api/apply/tracker");
}

export async function patchTrackerStatus(applicationFolder: string, status: string) {
  const res = await fetch("/api/apply/tracker/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationFolder, status }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body && body.error) || `Status update failed (${res.status})`);
  }
  return body;
}

export function fetchOutbox(): Promise<OutboxResponse> {
  return getJson<OutboxResponse>("/api/apply/outbox");
}

export function fetchScout(): Promise<ScoutResponse> {
  return getJson<ScoutResponse>("/api/apply/scout");
}

export function fetchApplicationDetail(folder: string): Promise<ApplicationDetail> {
  return getJson<ApplicationDetail>(`/api/apply/applications/${encodeURIComponent(folder)}`);
}

export function pdfUrl(relPath: string): string {
  return `/api/apply/pdf?path=${encodeURIComponent(relPath)}`;
}

export async function openInOsApp(relPath: string): Promise<void> {
  const res = await fetch("/api/apply/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body && body.error) || `Open failed (${res.status})`);
  }
}

export async function uploadPdf(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/apply/upload", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body && body.error) || `Upload failed (${res.status})`);
  return body as UploadResult;
}

export async function writeJd(input: {
  company: string;
  roleTitle: string;
  sourceUrl: string;
  text: string;
}): Promise<JdWriteResult> {
  const res = await fetch("/api/apply/jd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body && body.error) || `Failed to save job posting (${res.status})`);
  return body as JdWriteResult;
}

export async function writeCvImport(text: string): Promise<CvImportResult> {
  const res = await fetch("/api/apply/cv-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body && body.error) || `Failed to import CV (${res.status})`);
  return body as CvImportResult;
}
