/**
 * Small, deliberately non-general markdown-table + frontmatter parsing
 * helpers shared by the tracker/outbox/applications/scout read routes.
 * Not a full markdown/YAML parser — just enough structure to read the
 * specific pipe-table and simple-scalar-frontmatter shapes the job-hunt
 * skills actually produce.
 */

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

const TABLE_ROW_RE = /^\|(.+)\|$/;
// A separator row like `|---|---|` or `| :--- | ---: |` — must contain at
// least one dash so a stray one-pipe prose line never matches it.
const TABLE_SEP_RE = /^\|?[\s:|-]+\|?$/;

function splitTableRow(line: string): string[] {
  const inner = line.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/** Find the first pipe-table (header row + `---` separator + data rows) in
 *  `raw` and parse it. Returns null if no table is found — callers must
 *  treat that as "no rows", never throw. Stops at the first line after the
 *  separator that isn't itself a pipe-table row (blank line, heading,
 *  prose paragraph, ...). */
export function parseFirstMarkdownTable(raw: string): ParsedTable | null {
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const headerLine = lines[i].trim();
    const sepLine = lines[i + 1].trim();
    if (!TABLE_ROW_RE.test(headerLine)) continue;
    if (!TABLE_SEP_RE.test(sepLine) || !sepLine.includes("-")) continue;

    const headers = splitTableRow(headerLine);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!TABLE_ROW_RE.test(line)) break;
      rows.push(splitTableRow(line));
    }
    return { headers, rows };
  }
  return null;
}

/** Split a cell like scout\latest.md's "key matches"/"gaps" columns on
 *  top-level commas only — a comma nested inside `(...)` (e.g. "AdonisJS
 *  (a NestJS, adjacent)") is kept intact rather than splitting mid-clause.
 *  Strips markdown bold markers and drops empty segments. */
export function splitOutsideParens(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.map((seg) => seg.replace(/\*\*/g, "").trim()).filter(Boolean);
}

/** Extract the leading percentage from a cell like "~75% (7.5/10
 *  requirement keywords)". Returns null for prose-only cells like "partial
 *  listing (card only)" that carry no percentage at all. */
export function extractLeadingPercent(cell: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(cell);
  return m ? Number(m[1]) : null;
}

/** True for cells starting with (optionally bold-wrapped) "yes" —
 *  scout\latest.md's "queued?" column uses "**yes**" / "no — <reason>". */
export function looksLikeYes(cell: string): boolean {
  return /^\*{0,2}yes\b/i.test(cell.trim());
}

export interface ParsedFrontmatter {
  data: Record<string, string>;
  body: string;
}

/** Minimal frontmatter parser for flat `key: value` scalars only (no nested
 *  maps/lists) — sufficient for the outreach draft files' frontmatter
 *  (to/to_name/subject/attachments/language/confidence_tier), all
 *  single-line values. Returns the whole input as `body` with empty `data`
 *  if there's no `---`-delimited block at the very start. */
export function parseSimpleFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const closeIdx = raw.indexOf("\n---", 3);
  if (closeIdx === -1) return { data: {}, body: raw };
  const fmBlock = raw.slice(3, closeIdx).trim();
  const afterClose = raw.indexOf("\n", closeIdx + 4);
  const body = afterClose === -1 ? "" : raw.slice(afterClose + 1);

  const data: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    data[m[1]] = m[2].trim();
  }
  return { data, body: body.replace(/^\r?\n+/, "") };
}
