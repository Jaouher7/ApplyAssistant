/**
 * Types shared by the Apply Assistant's server routes and client panel.
 * Ported verbatim from the Agent Traffic Dashboard's prototype build of
 * this feature (see the project's own README for the history). Import with
 * `import type` only; this file is consumed as types, never at runtime.
 */

export type ApplyClassification = "job_posting" | "cv" | "ambiguous";

export interface ApplyStatus {
  jobHuntConfigured: boolean;
  root: string; // absolute JOB_HUNT_ROOT, or "" when unset/invalid
  cliFound: boolean;
}

export interface UploadResult {
  filename: string;
  textLength: number;
  classification: ApplyClassification;
  confidence: number; // 0..1
  signals: { cv: string[]; jobPosting: string[] };
  text: string;
  suggested: { company: string; roleTitle: string };
}

export interface JdWriteResult {
  relPath: string;
  absPath: string;
  filename: string;
}

export interface CvImportResult {
  relPath: string;
  absPath: string;
}

// Trimmed from AgentOS's shared/driver.ts to the events this build actually
// streams.
export type DriverEvent =
  | { type: "session-init"; sessionId: string; model: string }
  | { type: "assistant-text"; text: string }
  | { type: "tool-use"; id: string; name: string; input: unknown; parentId?: string }
  | { type: "tool-result"; id: string; preview: string; isError: boolean }
  | { type: "turn-complete"; subtype: string; costUsd?: number; isError: boolean }
  | { type: "driver-error"; message: string };

export type ApplyClientFrame = { type: "send"; text: string } | { type: "interrupt" };

export type ApplyServerFrame =
  | { type: "state"; busy: boolean; cliFound: boolean; configured: boolean }
  | { type: "driver"; event: DriverEvent }
  | { type: "error"; message: string };

// --- Phase 2: read/write access to the job-hunt data tree -----------------
// Types for the tracker/outbox/applications/scout/profile/file/pdf routes.
// Every one of these routes degrades to `configured:false` (never throws)
// when JOB_HUNT_ROOT is unset — see server/src/config.ts's jailed().

/** The only statuses PATCH /api/apply/tracker/status accepts. */
export type TrackerStatus =
  | "drafted"
  | "contacted"
  | "replied"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

/** One data row of tracker.csv. `notes` is the last column and may itself
 *  contain unescaped commas in the real file — the parser absorbs the
 *  remainder into it rather than splitting further. */
export interface TrackerRow {
  date_added: string;
  company: string;
  role: string;
  location: string;
  language: string;
  jd_source: string;
  application_folder: string;
  cv_path: string;
  letter_path: string;
  contacts_found: number;
  outreach_drafted: number;
  outreach_sent: number;
  status: string;
  last_updated: string;
  notes: string;
}

export interface TrackerResponse {
  configured: boolean;
  rows: TrackerRow[];
}

export interface TrackerStatusPatchInput {
  applicationFolder: string;
  status: string;
}

/** One parsed line of outbox\manifest.md:
 *  `[ ] <date> — <company> — <contact> — <subject> — <draftPath>`. */
export interface OutboxItem {
  reviewed: boolean;
  date: string;
  company: string;
  contact: string;
  subject: string;
  draftPath: string;
}

export interface OutboxResponse {
  configured: boolean;
  items: OutboxItem[];
}

export interface OutboxTogglePatchInput {
  draftPath: string;
  reviewed: boolean;
}

export interface ApplicationsListResponse {
  configured: boolean;
  folders: string[];
}

export interface ApplicationFileEntry {
  name: string;
  ext: string;
  sizeBytes: number;
}

/** One row of an application folder's contacts.md table. */
export interface Contact {
  name: string;
  title: string;
  email: string;
  confidence: string;
  source: string;
  notes: string;
}

/** One row of an application folder's keyword-match.md table. `present` is
 *  true only for a literal "yes" cell; `presentLabel` preserves the raw
 *  yes/no/partial label so a "partial" match isn't silently collapsed into
 *  a boolean false. */
export interface KeywordMatch {
  keyword: string;
  present: boolean;
  presentLabel: string;
  note: string;
}

export interface AtsLintResult {
  pass: boolean;
  raw: string;
}

/** One outreach\draft-*.md file's parsed frontmatter + body. */
export interface DraftSummary {
  file: string;
  to: string;
  toName: string;
  subject: string;
  confidenceTier: string;
  language: string;
  body: string;
}

export interface ApplicationDetail {
  configured: boolean;
  folder: string;
  files: ApplicationFileEntry[];
  contacts: Contact[];
  keywords: KeywordMatch[];
  atsLint: AtsLintResult | null;
  drafts: DraftSummary[];
  jobDescription: string | null;
}

/** One row of scout\latest.md's main table. `match` is the leading
 *  percentage extracted from cells like "~75% (7.5/10 requirement
 *  keywords)"; null for prose-only cells like "partial listing (card
 *  only)". `keyMatches`/`gaps` are split on top-level commas (parenthesised
 *  commas are kept intact). */
export interface ScoutRow {
  rank: string;
  company: string;
  role: string;
  posted: string;
  location: string;
  match: number | null;
  keyMatches: string[];
  gaps: string[];
  sourceUrl: string | null;
  queued: boolean;
}

export interface ScoutResponse {
  configured: boolean;
  found: boolean;
  updated: string | null;
  rows: ScoutRow[];
  raw: string;
}

export interface FileReadResponse {
  path: string;
  content: string;
}

export interface ProfileReadResponse {
  content: string;
}

export interface OpenFileInput {
  path: string;
}
