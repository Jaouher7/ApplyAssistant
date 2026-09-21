import fs from "node:fs";
import path from "node:path";
import { jailed } from "../config";
import type { CvImportResult, JdWriteResult } from "../../../shared/apply";

/** Thrown by writeIncomingJD on invalid input: missing required fields, or
 *  company/roleTitle containing ".." or a path separator. The latter is a
 *  defense-in-depth *reject* on top of jailed()'s structural guard —
 *  slugify() below would otherwise just silently strip such characters and
 *  still succeed, which is safe but not what an explicit path-traversal
 *  attempt should get back (never crash, but also never silently
 *  sanitize-and-allow a hostile input where an explicit reject is the more
 *  honest response). Route turns this into a 400. */
export class JdInvalidInputError extends Error {}

/** Thrown by writeIncomingJD when the generated slug's file already exists —
 *  the route turns this into a 409 so the user renames rather than silently
 *  overwriting a previous paste. */
export class JdSlugCollisionError extends Error {}

/** Thrown by writeCvPendingImport on missing/empty text. Route turns this
 *  into a 400. */
export class CvImportInvalidInputError extends Error {}

const PATH_TRAVERSAL_RE = /\.\.|[\\/]/;

/** Strip Unicode combining-diacritical-marks (U+0300..U+036F) left behind by
 *  NFKD decomposition (e.g. "é" splits into "e" + COMBINING ACUTE ACCENT).
 *  Filters by char code rather than a regex range literal, to avoid any
 *  ambiguity between a range escape and a literal accented character in
 *  source — ported verbatim from AgentOS server/src/services/jobHunt.ts. Do
 *  not "simplify" this back to a regex character range. */
function stripCombiningMarks(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) continue;
    out += ch;
  }
  return out;
}

/** lowercase, ascii-safe, hyphenated slug — company+role → filename stem.
 *  Ported verbatim from AgentOS jobHunt.ts's slugify(). */
function slugify(s: string): string {
  return stripCombiningMarks(s.normalize("NFKD"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Frontmatter fields are single-line scalars in _template.md — collapse any
 *  stray newline a paste might carry so it can never split the YAML block. */
function oneLine(s: string): string {
  return s.replace(/\r?\n+/g, " ").trim();
}

function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

export interface JdIntakeInput {
  company: string;
  roleTitle: string;
  sourceUrl?: string;
  text: string;
}

/** Write a new job-hunt\jobs\incoming\<slug>.md matching _template.md's
 *  exact frontmatter shape. The pasted JD text is placed only under
 *  "## Posting text", after the closing "---", and is never re-parsed or
 *  re-serialized through a YAML library — a stray "---" inside the pasted
 *  body is inert. Jailed to JOB_HUNT_ROOT; throws JdSlugCollisionError on an
 *  existing slug instead of silently overwriting. */
export function writeIncomingJD(input: JdIntakeInput): JdWriteResult {
  const company = (input.company ?? "").trim();
  const roleTitle = (input.roleTitle ?? "").trim();
  const sourceUrl = (input.sourceUrl ?? "").trim();
  const text = input.text ?? "";

  if (!company || !roleTitle || !text.trim()) {
    throw new JdInvalidInputError("company, roleTitle, and text are required");
  }
  if (PATH_TRAVERSAL_RE.test(company) || PATH_TRAVERSAL_RE.test(roleTitle)) {
    throw new JdInvalidInputError(
      'company and roleTitle may not contain ".." or a path separator',
    );
  }

  const slug = slugify(`${company}-${roleTitle}`) || "job";
  const filename = `${slug}.md`;
  const relPath = path.join("jobs", "incoming", filename);
  const abs = jailed(relPath);

  if (fs.existsSync(abs)) {
    throw new JdSlugCollisionError(
      `"${filename}" already exists in jobs\\incoming\\ — rename company/role to avoid overwriting a previous paste.`,
    );
  }

  const content =
    `---\n` +
    `company: ${oneLine(company)}\n` +
    `role_title: ${oneLine(roleTitle)}\n` +
    `source_url: ${oneLine(sourceUrl)}\n` +
    `date_added: ${todayISODate()}\n` +
    `---\n` +
    `\n` +
    `## Posting text\n` +
    `\n` +
    `${text}\n`;

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");

  return { relPath, absPath: abs, filename };
}

export interface CvImportInput {
  text: string;
}

/** Write JOB_HUNT_ROOT\profile\_pending-import-<YYYY-MM-DD>.md — the CV-
 *  safety call. The target filename is entirely server-generated from
 *  today's date; there is no filename or path parameter accepted from the
 *  client anywhere in this function's signature, so it is structurally
 *  impossible for this code path to touch master-profile.*.md /
 *  achievement-bank.*.md / skills-inventory.yaml. A same-day collision gets
 *  a numeric "-2", "-3", ... suffix — never overwritten. */
export function writeCvPendingImport(input: CvImportInput): CvImportResult {
  const text = input.text ?? "";
  if (!text.trim()) {
    throw new CvImportInvalidInputError("text is required");
  }

  const date = todayISODate();
  let filename = `_pending-import-${date}.md`;
  let suffix = 2;
  while (fs.existsSync(jailed(path.join("profile", filename)))) {
    filename = `_pending-import-${date}-${suffix}.md`;
    suffix += 1;
  }
  const relPath = path.join("profile", filename);
  const abs = jailed(relPath);

  const content =
    `---\n` +
    `imported_from: apply-assistant\n` +
    `imported_at: ${new Date().toISOString()}\n` +
    `status: pending-review\n` +
    `---\n` +
    `\n` +
    `<!--\n` +
    `Auto-extracted CV text. Review and MERGE by hand into master-profile.*.md —\n` +
    `this file is NOT read by any skill or workflow and never overwrites the\n` +
    `curated profile. Delete it once merged.\n` +
    `-->\n` +
    `\n` +
    `${text}\n`;

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");

  return { relPath, absPath: abs };
}
