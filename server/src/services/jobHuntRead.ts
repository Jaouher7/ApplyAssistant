/**
 * Read (and two narrowly-scoped write) access to the job-hunt data tree for
 * the UI overhaul's data layer: tracker.csv, outbox\manifest.md, per-
 * application folders, scout\latest.md, whitelisted profile\ files, and
 * generic text/PDF file reads. Every exported function here is jailed to
 * JOB_HUNT_ROOT via `jailed()` (server/src/config.ts) and never throws for
 * "file missing" / "JOB_HUNT_ROOT unset" — those degrade to an empty/
 * `configured:false` shape, matching the existing routes' stance. The two
 * mutations (updateTrackerStatus, toggleOutboxItem) are the exception: they
 * throw typed errors the routes translate into 400/404, since a caller
 * needs to know *why* a PATCH didn't apply.
 *
 * tracker.csv / outbox\manifest.md parsing (splitCsvLine's last-column-
 * absorbs-commas trick, the outbox line regex, detectEol) is ported
 * near-verbatim from AgentOS's server/src/services/jobHunt.ts — see that
 * file's own doc comments for why each shape is what it is.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { jailed, JOB_HUNT_ROOT, isJobHuntConfigured } from "../config";
import {
  parseFirstMarkdownTable,
  parseSimpleFrontmatter,
  splitOutsideParens,
  extractLeadingPercent,
  looksLikeYes,
} from "./markdownTable";
import type {
  ApplicationDetail,
  ApplicationFileEntry,
  AtsLintResult,
  Contact,
  DraftSummary,
  KeywordMatch,
  OutboxItem,
  ScoutResponse,
  ScoutRow,
  TrackerRow,
  TrackerStatus,
} from "../../../shared/apply";

const TRACKER_STATUSES: readonly TrackerStatus[] = [
  "drafted",
  "contacted",
  "replied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
];

/**
 * The scout shortlist's "source URL" cell is written by hand and is not
 * reliably a URL: it may be a markdown link `[label](https://...)`, a bare
 * URL, or plain prose such as "HelloWork landing scan only; no stable direct
 * link found". Feeding a non-URL straight into an anchor's href makes the
 * browser treat it as a RELATIVE path, which lands back on the SPA and
 * silently bounces the user to the default view. Return a usable absolute
 * http(s) URL, or null so the caller can omit the link entirely.
 */
function extractUrl(cell: string | undefined): string | null {
  if (!cell) return null;
  const md = cell.match(/\]\(\s*(https?:\/\/[^\s)]+)\s*\)/);
  if (md) return md[1];
  const bare = cell.match(/https?:\/\/[^\s)\]]+/);
  return bare ? bare[0] : null;
}

export function isValidTrackerStatus(s: string): s is TrackerStatus {
  return (TRACKER_STATUSES as readonly string[]).includes(s);
}

const TRACKER_NUMERIC_COLUMNS = new Set([
  "contacts_found",
  "outreach_drafted",
  "outreach_sent",
]);

/** Split a CSV data line into exactly `numFields` columns, letting the last
 *  column absorb any remaining commas — tracker.csv's `notes` column (always
 *  last) may contain unescaped commas in the real file. Ported from
 *  AgentOS jobHunt.ts. */
function splitCsvLine(line: string, numFields: number): string[] {
  const parts = line.split(",");
  if (parts.length <= numFields) {
    while (parts.length < numFields) parts.push("");
    return parts;
  }
  const head = parts.slice(0, numFields - 1);
  const rest = parts.slice(numFields - 1).join(",");
  return [...head, rest];
}

/** Detect defensively rather than assume, so a rewrite never silently
 *  changes line-ending style. */
function detectEol(raw: string): string {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function rowFromCols(header: string[], cols: string[]): TrackerRow {
  const row: Record<string, string | number> = {};
  header.forEach((h, i) => {
    const raw = cols[i] ?? "";
    row[h] = TRACKER_NUMERIC_COLUMNS.has(h) ? Number(raw) || 0 : raw;
  });
  return row as unknown as TrackerRow;
}

/** Read + parse tracker.csv into rows. Never throws — a missing/unreadable
 *  file (or unconfigured JOB_HUNT_ROOT) just yields no rows. */
export function readTracker(): TrackerRow[] {
  let raw: string;
  try {
    raw = fs.readFileSync(jailed("tracker.csv"), "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => rowFromCols(header, splitCsvLine(line, header.length)));
}

export class TrackerRowNotFoundError extends Error {}
export class InvalidTrackerStatusError extends Error {}

/** Update one tracker.csv row's `status` (and `last_updated`) column,
 *  matching on `application_folder`. Fresh read-modify-write on every call
 *  (never caches the file) and only ever rewrites the one matched line's
 *  status/last_updated columns — every other line, and every other column
 *  of the matched line, is copied through byte-identical. */
export function updateTrackerStatus(folder: string, status: string): TrackerRow {
  if (!isValidTrackerStatus(status)) {
    throw new InvalidTrackerStatusError(
      `"${status}" is not a valid status — expected one of: ${TRACKER_STATUSES.join(", ")}`,
    );
  }

  const abs = jailed("tracker.csv");
  const raw = fs.readFileSync(abs, "utf8");
  const eol = detectEol(raw);
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2) {
    throw new TrackerRowNotFoundError("tracker.csv has no data rows");
  }
  const header = lines[0].split(",").map((h) => h.trim());
  const folderIdx = header.indexOf("application_folder");
  const statusIdx = header.indexOf("status");
  const lastUpdatedIdx = header.indexOf("last_updated");
  if (folderIdx === -1 || statusIdx === -1 || lastUpdatedIdx === -1) {
    throw new TrackerRowNotFoundError("tracker.csv is missing expected columns");
  }
  const targetFolder = path.join("applications", folder);

  let matchedRow: TrackerRow | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = splitCsvLine(line, header.length);
    const cell = cols[folderIdx] ?? "";
    if (cell !== targetFolder && path.basename(cell) !== folder) continue;

    cols[statusIdx] = status;
    cols[lastUpdatedIdx] = todayISODate();
    lines[i] = cols.join(",");
    matchedRow = rowFromCols(header, cols);
    break;
  }

  if (!matchedRow) {
    throw new TrackerRowNotFoundError(
      `No tracker.csv row found with application_folder matching "${folder}"`,
    );
  }

  fs.writeFileSync(abs, lines.join(eol), "utf8");
  return matchedRow;
}

// `[ ] <date> — <company> — <contact> — <subject> — <draftPath>`, where
// <subject> itself may contain further " — " segments — the non-greedy
// groups backtrack until the final group matches a bare (no-space) `*.md`
// path, so this still resolves correctly. Lines that don't match (headings,
// prose) are skipped, not thrown on. Ported from AgentOS jobHunt.ts.
const OUTBOX_LINE_RE =
  /^\[( |x|X)\]\s*(.+?)\s*—\s*(.+?)\s*—\s*(.+?)\s*—\s*(.+?)\s*—\s*(\S+\.md)\s*$/;

/** Read + parse outbox\manifest.md into structured pending-draft entries.
 *  Never throws — missing file (or unconfigured root) yields no items. */
export function readOutbox(): OutboxItem[] {
  let raw: string;
  try {
    raw = fs.readFileSync(jailed(path.join("outbox", "manifest.md")), "utf8");
  } catch {
    return [];
  }
  const items: OutboxItem[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = OUTBOX_LINE_RE.exec(line.trim());
    if (!m) continue;
    items.push({
      reviewed: m[1].toLowerCase() === "x",
      date: m[2],
      company: m[3],
      contact: m[4],
      subject: m[5],
      draftPath: m[6],
    });
  }
  return items;
}

export class OutboxItemNotFoundError extends Error {}

/** Flip one outbox\manifest.md line's `[ ]`/`[x]` checkbox, matching on the
 *  draft file path (unique per line). Rewrites the file with every other
 *  line byte-identical: only the leading checkbox token of the matched line
 *  is replaced. Fresh read-modify-write on every call. */
export function toggleOutboxItem(draftPath: string, reviewed: boolean): OutboxItem[] {
  const abs = jailed(path.join("outbox", "manifest.md"));
  const raw = fs.readFileSync(abs, "utf8");
  const eol = detectEol(raw);
  const lines = raw.split(/\r?\n/);

  let matched = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = OUTBOX_LINE_RE.exec(line.trim());
    if (!m || m[6] !== draftPath) continue;
    const newBox = reviewed ? "[x]" : "[ ]";
    lines[i] = line.replace(/^(\s*)\[( |x|X)\]/, `$1${newBox}`);
    matched = true;
    break;
  }

  if (!matched) {
    throw new OutboxItemNotFoundError(
      `No outbox\\manifest.md line found with draft path "${draftPath}"`,
    );
  }

  fs.writeFileSync(abs, lines.join(eol), "utf8");
  return readOutbox();
}

/** Directory names directly under applications\ — never throws; missing
 *  applications\ (or unconfigured root) yields an empty list. */
export function listApplicationFolders(): string[] {
  let abs: string;
  try {
    abs = jailed("applications");
  } catch {
    return [];
  }
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function listFolderFiles(folder: string): ApplicationFileEntry[] {
  const dir = jailed(path.join("applications", folder));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ApplicationFileEntry[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = path.join(dir, e.name);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(abs).size;
    } catch {
      // leave 0
    }
    out.push({ name: e.name, ext: path.extname(e.name).replace(/^\./, ""), sizeBytes });
  }
  return out;
}

function readContacts(folder: string): Contact[] {
  let raw: string;
  try {
    raw = fs.readFileSync(jailed(path.join("applications", folder, "contacts.md")), "utf8");
  } catch {
    return [];
  }
  const table = parseFirstMarkdownTable(raw);
  if (!table) return [];
  return table.rows.map((cols) => ({
    name: cols[0] ?? "",
    title: cols[1] ?? "",
    email: cols[2] ?? "",
    confidence: cols[3] ?? "",
    source: cols[4] ?? "",
    notes: cols[5] ?? "",
  }));
}

function readKeywords(folder: string): KeywordMatch[] {
  let raw: string;
  try {
    raw = fs.readFileSync(
      jailed(path.join("applications", folder, "keyword-match.md")),
      "utf8",
    );
  } catch {
    return [];
  }
  const table = parseFirstMarkdownTable(raw);
  if (!table) return [];
  return table.rows.map((cols) => {
    const presentLabel = cols[1] ?? "";
    return {
      keyword: cols[0] ?? "",
      present: presentLabel.trim().toLowerCase() === "yes",
      presentLabel,
      note: cols[2] ?? "",
    };
  });
}

/** Detects PASS/FAIL from the report's own closing "**Overall: PASS**" /
 *  "**Overall: FAIL**" line (confirmed against the real report's shape) —
 *  never throws; a missing file yields null, not an error. */
function readAtsLint(folder: string): AtsLintResult | null {
  let raw: string;
  try {
    raw = fs.readFileSync(
      jailed(path.join("applications", folder, "ats-lint-report.md")),
      "utf8",
    );
  } catch {
    return null;
  }
  const pass = /overall:\s*\**pass\**/i.test(raw);
  return { pass, raw };
}

function readDrafts(folder: string): DraftSummary[] {
  const dir = jailed(path.join("applications", folder, "outreach"));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DraftSummary[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, e.name), "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseSimpleFrontmatter(raw);
    out.push({
      file: path.join("applications", folder, "outreach", e.name),
      to: data.to ?? "",
      toName: data.to_name ?? "",
      subject: data.subject ?? "",
      confidenceTier: data.confidence_tier ?? "",
      language: data.language ?? "",
      body: body.trim(),
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function readJobDescription(folder: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(
      jailed(path.join("applications", folder, "job-description.md")),
      "utf8",
    );
  } catch {
    return null;
  }
  const { body } = parseSimpleFrontmatter(raw);
  return body.trim() || raw.trim();
}

/** Full detail for one applications\<folder>\ — never throws for missing
 *  sub-files (each degrades to null/empty independently); throws only if
 *  `folder` itself doesn't exist as a directory, which the route turns into
 *  a 404. */
export class ApplicationFolderNotFoundError extends Error {}

export function getApplicationDetail(folder: string): ApplicationDetail {
  const dir = jailed(path.join("applications", folder));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new ApplicationFolderNotFoundError(`"${folder}" does not exist under applications\\`);
  }
  if (!stat.isDirectory()) {
    throw new ApplicationFolderNotFoundError(`"${folder}" is not a directory`);
  }

  return {
    configured: true,
    folder,
    files: listFolderFiles(folder),
    contacts: readContacts(folder),
    keywords: readKeywords(folder),
    atsLint: readAtsLint(folder),
    drafts: readDrafts(folder),
    jobDescription: readJobDescription(folder),
  };
}

/** Read scout\latest.md and parse its main table. Never throws:
 *  `found:false` for a missing scout\ folder or latest.md file. */
export function readScoutLatest(): ScoutResponse {
  if (!isJobHuntConfigured()) {
    return { configured: false, found: false, updated: null, rows: [], raw: "" };
  }
  let abs: string;
  try {
    abs = jailed(path.join("scout", "latest.md"));
  } catch {
    return { configured: true, found: false, updated: null, rows: [], raw: "" };
  }
  let stat: fs.Stats;
  let raw: string;
  try {
    stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error("not a file");
    raw = fs.readFileSync(abs, "utf8");
  } catch {
    return { configured: true, found: false, updated: null, rows: [], raw: "" };
  }

  const table = parseFirstMarkdownTable(raw);
  const rows: ScoutRow[] = (table?.rows ?? []).map((cols) => ({
    rank: cols[0] ?? "",
    company: cols[1] ?? "",
    role: cols[2] ?? "",
    posted: cols[3] ?? "",
    location: cols[4] ?? "",
    match: extractLeadingPercent(cols[5] ?? ""),
    keyMatches: splitOutsideParens(cols[6] ?? ""),
    gaps: splitOutsideParens(cols[7] ?? ""),
    sourceUrl: extractUrl(cols[8]),
    queued: looksLikeYes(cols[9] ?? ""),
  }));

  return { configured: true, found: true, updated: stat.mtime.toISOString(), rows, raw };
}

/** Only these two profile\ files are ever readable through this route — no
 *  arbitrary profile path, and no write path here at all. */
const PROFILE_WHITELIST = new Set(["master-profile.en.md", "master-profile.fr.md"]);

export class ProfileFileNotAllowedError extends Error {}

export function readProfileFile(name: string): string {
  if (!PROFILE_WHITELIST.has(name)) {
    throw new ProfileFileNotAllowedError(`"${name}" is not a whitelisted profile file`);
  }
  return fs.readFileSync(jailed(path.join("profile", name)), "utf8");
}

/** Text-file extensions readable through GET /api/apply/file. Deliberately
 *  narrow — never .docx/.pdf (those are binary; .pdf has its own streaming
 *  route) and never anything unbounded like "any file". */
const TEXT_FILE_EXTENSIONS = new Set([".md", ".csv", ".yaml", ".yml", ".txt"]);

export class FileNotAllowedError extends Error {}
export class FileNotFoundError extends Error {}

/** Read one text file under JOB_HUNT_ROOT. Jailed; extension-allowlisted.
 *  Throws FileNotAllowedError (→ 400) for a disallowed extension or a path
 *  that escapes JOB_HUNT_ROOT, FileNotFoundError (→ 404) if it doesn't
 *  exist. */
export function readTextFile(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  if (!TEXT_FILE_EXTENSIONS.has(ext)) {
    throw new FileNotAllowedError(
      `Only ${[...TEXT_FILE_EXTENSIONS].join(", ")} files may be read (got "${ext || "no extension"}")`,
    );
  }
  let abs: string;
  try {
    abs = jailed(relPath);
  } catch {
    throw new FileNotAllowedError("Path escapes the job-hunt root");
  }
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    throw new FileNotFoundError(`"${relPath}" does not exist`);
  }
}

/** Resolve + validate a .pdf path under JOB_HUNT_ROOT for streaming — the
 *  route does the actual fs.createReadStream/reply.send. Jailed; `.pdf`
 *  only. Throws FileNotAllowedError (→ 400) / FileNotFoundError (→ 404). */
export function resolvePdfPath(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  if (ext !== ".pdf") {
    throw new FileNotAllowedError(`Only .pdf files may be read here (got "${ext || "no extension"}")`);
  }
  let abs: string;
  try {
    abs = jailed(relPath);
  } catch {
    throw new FileNotAllowedError("Path escapes the job-hunt root");
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new FileNotFoundError(`"${relPath}" does not exist`);
  }
  return abs;
}

export class OpenFileInvalidError extends Error {}
export class OpenFileNotFoundError extends Error {}

/** Only extensions ever allowed through POST /api/apply/open —
 *  cv.docx/letter.docx/cv.pdf/letter.pdf are the only files this button is
 *  meant for. Deliberately narrower than the text-file/pdf-preview
 *  allowlists above: no .md, no .csv, nothing else. */
const OPEN_FILE_ALLOWED_EXTENSIONS = new Set([".docx", ".pdf"]);

/** Open a JOB_HUNT_ROOT-relative file in the OS default application. Local
 *  only: no network request, no mail API. Validates (in order) extension,
 *  jail, and existence *before* spawning anything. Uses the argv-array form
 *  of spawn — never a shell-interpolated string — so no path is ever passed
 *  through cmd's own metacharacter handling. Ported near-verbatim from
 *  AgentOS's server/src/services/jobHunt.ts openFile(). */
export function openFile(relPath: string): void {
  const ext = path.extname(relPath).toLowerCase();
  if (!OPEN_FILE_ALLOWED_EXTENSIONS.has(ext)) {
    throw new OpenFileInvalidError(
      `Only ${[...OPEN_FILE_ALLOWED_EXTENSIONS].join(", ")} files may be opened (got "${ext || "no extension"}")`,
    );
  }

  let abs: string;
  try {
    abs = jailed(relPath);
  } catch {
    throw new OpenFileInvalidError("Path escapes the job-hunt root");
  }

  if (!fs.existsSync(abs)) {
    throw new OpenFileNotFoundError(`"${relPath}" does not exist`);
  }

  // `start`'s own syntax is `start "<title>" "<target>"` — the literal `""`
  // argv element is a required empty-title placeholder, otherwise a quoted
  // absolute path would itself be consumed as the title instead of the
  // target. argv array, never a shell string.
  const child = spawn("cmd", ["/c", "start", '""', abs], {
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

export { JOB_HUNT_ROOT };
