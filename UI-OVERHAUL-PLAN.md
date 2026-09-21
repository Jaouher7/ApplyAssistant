# Apply Assistant — UI / feature overhaul plan

> **Repo-hygiene note (read first).** This document is written to be safe to
> commit: it contains no machine-specific absolute paths, no personal names,
> no real company names, and no real contact data. Every path is written
> relative to `<JOB_HUNT_ROOT>` (the env-configured job-hunt folder) or to
> this repo's own root, and every example is synthetic (`Acme`,
> `acme-dev-fullstack-20260101`). Keep it that way when editing — a planning
> doc sitting in a repo working tree is exactly the artifact that historically
> leaked real data into a public repo here.

---

## 1. Requirements

### 1.1 What exists today

A standalone npm-workspaces app (`server/` Fastify 5 + `client/` React 18 +
Vite 5 + a flat `shared/`), with **one** screen: a PDF drop zone that
classifies job-posting-vs-CV and routes the text into the sibling job-hunt
project, plus a chat panel that spawns the local `claude` CLI over
`/ws/apply` and streams a turn. Server routes today are exactly:

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /api/apply/status` | `{ jobHuntConfigured, root, cliFound }` |
| `POST /api/apply/upload` | multipart PDF → in-memory text + classification |
| `POST /api/apply/jd` | write `jobs\incoming\<slug>.md` |
| `POST /api/apply/cv-import` | write `profile\_pending-import-<date>.md` |
| `WS /ws/apply` | CLI chat driver (single-flight, broadcast) |

The client has **zero dependencies beyond `react`/`react-dom`**, one
`styles.css` of hand-written dark tokens, and no router, no store, no data
layer.

### 1.2 What we are building

Turn the app into a **mission control for the job hunt**: a multi-view
dashboard over the data that the job-hunt pipeline already produces on disk
(`tracker.csv`, `outbox\manifest.md`, `applications\<app>\*`, `scout\*.md`,
`profile\*`), with the existing intake + assistant chat folded in as
first-class but no longer *the whole app*.

Seven views:

1. **Overview** — KPI tiles, status funnel, activity sparkline, "needs
   attention" nudges.
2. **Pipeline** — Kanban of applications across the tracker status enum,
   drag-and-drop status changes written back to `tracker.csv`.
3. **Application detail** — a drawer with embedded PDF preview, contacts,
   keyword-match, ATS lint, and outreach drafts.
4. **Scout** — the ranked shortlist as rich cards instead of raw markdown.
5. **Outbox** — pending outreach drafts, copy-body, mark-reviewed, open
   attachments.
6. **Profile** — master profile rendered + a "profile health" readout.
7. **Assistant** — today's chat, restyled, dockable from every view, plus a
   ⌘K/Ctrl+K command palette, with real tool-call rendering.

**Who it's for:** exactly one local user, on one machine, in one browser tab,
reading their own private data over `127.0.0.1`. Every architectural choice
below leans on that.

### 1.3 Non-goals (explicit)

- **No email sending. Ever.** No SMTP, no nodemailer, no mail API, no
  `mailto:` links either (a `mailto:` is a send affordance; copy the address
  to the clipboard instead). The outbox is review-and-copy only. This is a
  standing, repeatedly-confirmed constraint, not a phase-1 simplification.
- **No writes to `<JOB_HUNT_ROOT>\profile\master-profile.*.md`,
  `achievement-bank.*.md`, or `skills-inventory.yaml`** from any UI path. CV
  imports keep going to `profile\_pending-import-<date>.md` for manual merge.
- **No editable tracker fields other than `status`.** Notes/contacts/paths
  stay CLI- and hand-edited (same locked-in decision the sibling AgentOS
  dashboard took).
- No auth, no multi-user, no accounts, no DB, no server-side persistence of
  anything (the filesystem in job-hunt *is* the database).
- No server-side spawning of pipeline/scout runs. Sweeps and pipeline runs go
  through the existing chat driver as an anchored prompt, exactly as today.
- No new markdown *authoring* in the UI (read + copy only).
- No mobile-first design. The layout must not break in a narrow window, but
  a phone is not a target.
- No test framework introduction beyond `node --test` for pure parsers.
- No personal data, fixtures copied from job-hunt, or screenshots of real
  data committed into this repo.

---

## 2. Stack decision

| Choice | Decision | One-line justification |
|---|---|---|
| Server framework | **Keep Fastify 5** | Already here, already has the WS + multipart plugins registered; nothing about this feature set argues for a change. |
| Route organization | **New `server/src/routes/jobhunt.ts` Fastify plugin** | We add ~14 routes; `index.ts` is already 300 lines and inlining them (AgentOS's approach) would triple it. |
| Frontmatter parsing (server) | **Add `gray-matter@^4.0.3`** (server-only) | Outreach drafts have real YAML frontmatter (`to`, `subject`, `attachments: [...]`, `confidence_tier`); it's the same lib the AgentOS port uses, and being server-only it costs the client bundle nothing. |
| Markdown *table* parsing | **Hand-rolled pure functions in `services/jobHuntParse.ts`** | `contacts.md`, `keyword-match.md`, and the scout shortlist are fixed-shape GFM tables; a 40-line splitter is more predictable than pulling a full markdown AST into the server, and it's unit-testable with `node --test`. |
| File watching | **`chokidar@^4` (server-only), Phase 8, optional** | `fs.watch` on Windows is unreliable for recursive dir trees; chokidar is the boring answer — but it is deliberately the *last* phase, behind a poll-on-focus fallback that ships first. |
| Client routing | **Hand-rolled hash router (~50 LOC)** | 7 views + one deep-linkable drawer; see §5.1. |
| Client data layer | **Plain `fetch` + `useResource` hook + one context provider** | See §5.2. |
| Client state | **React context (2 providers), no store lib** | Two pieces of genuinely shared state (job-hunt data cache, chat session); a store library would be a third concept for no gain. |
| Styling | **Keep plain CSS + CSS custom properties, split into per-view files** | The existing dark token set is the look the user explicitly liked; Vite handles `import "./pipeline.css"` per component with no extra tooling. |
| Drag and drop | **`@dnd-kit/core`** | The only DnD option with a first-class keyboard sensor + ARIA live announcements, which our a11y requirement makes non-negotiable (see §6.3). |
| Charts | **Hand-rolled SVG** | See §6.2 — a funnel, a sparkline, and a radial ring are ~150 lines of arithmetic total; chart libs cost 20–100 kB for axes/legends/tooltips we don't want. |
| Animation | **CSS transitions + one `@keyframes`, no lib** | See §6.1. |
| Icons | **`lucide-react`** | Tree-shakable per-icon ESM, consistent 24px grid, ~0.4–0.8 kB gz per icon actually used. |
| Markdown rendering | **`react-markdown@^9` + `remark-gfm@^4`, lazy-loaded** | Profile, JD, ATS report, letters — all real GFM with tables and accented French; hand-rolling this is a bug farm. Never add `rehype-raw` (§9.11). |
| PDF preview | **Same-origin `<iframe>` against a byte-streaming route** | The browser already has a PDF viewer; `pdfjs-dist` on the client would be ~330 kB gz to reimplement it (§6.5). |

---

## 3. Architecture

### 3.1 Shape

```
browser (Vite dev :5300, proxying /api and /ws)
  │
  ├── GET  /api/apply/status ─────────────► config gate for every view
  ├── GET  /api/jobhunt/*  ───────────────► read job-hunt state (jailed)
  ├── PATCH/POST /api/jobhunt/*  ─────────► the 3 allowed writes
  ├── GET  /api/jobhunt/pdf?path=… ───────► inline PDF bytes for <iframe>
  └── WS   /ws/apply  ────────────────────► chat turns + (Phase 8) fs-change pushes
        │
   Fastify :4320
        │  every path goes through config.ts `jailed()`
        ▼
   <JOB_HUNT_ROOT>\  (tracker.csv, applications\, outbox\, scout\, profile\)
```

Nothing new is persisted in this repo's tree. The server holds no state
beyond the existing single `CliDriver` and (Phase 8) a debounce timer.

### 3.2 Namespace decision

New routes live under **`/api/jobhunt/*`**, not `/api/apply/*`:

- `/api/apply/*` means "act on a document the user just handed us" (upload,
  classify, route).
- `/api/jobhunt/*` means "read/write the state of the job-hunt project."

This also makes the port from the sibling AgentOS dashboard's
`server/src/services/jobHunt.ts` near-verbatim — same route paths, same
response shapes, so its already-verified behavior carries over unchanged.

### 3.3 Route table

All routes: JSON unless stated; all return `503 { error: "not configured" }`
when `isJobHuntConfigured()` is false; all filesystem access goes through
`jailed()` from `server/src/config.ts`; none of them ever writes outside the
three sanctioned write targets.

**Port column:** ✅ = copy from AgentOS `services/jobHunt.ts` with only the
import path changed; ◐ = port the core, extend as noted; ✨ = new.

| # | Method + path | Port | Request | Response |
|---|---|---|---|---|
| 1 | `GET /api/jobhunt/tracker` | ✅ `readTracker()` | — | `{ rows: TrackerRow[] }` |
| 2 | `PATCH /api/jobhunt/tracker/:folder` | ◐ `updateTrackerRow()` | `{ status: TrackerStatus, expect?: { status: string; last_updated: string } }` | `200 { row: TrackerRow }` / `404` unknown folder / `409 { error, current: TrackerRow }` on `expect` mismatch / `400` invalid status |
| 3 | `GET /api/jobhunt/applications` | ✨ | `?refresh=1` optional | `{ applications: ApplicationSummary[] }` |
| 4 | `GET /api/jobhunt/applications/:folder` | ◐ builds on `listApplicationFiles()` | — | `ApplicationDetail` (see §3.5) |
| 5 | `GET /api/jobhunt/file?path=<rel>` | ◐ `readDraft()` | `path` relative to root, `.md`/`.txt`/`.yaml`/`.csv` only | `{ relPath, ext, frontmatter, body }` |
| 6 | `GET /api/jobhunt/pdf?path=<rel>` | ✨ | `path`, `.pdf` only | `200` raw bytes, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="…"`, `Cache-Control: no-store` |
| 7 | `GET /api/jobhunt/outbox` | ✅ `readOutbox()` | — | `{ items: OutboxItem[] }` |
| 8 | `POST /api/jobhunt/outbox/toggle` | ✅ `toggleOutboxItem()` | `{ draftPath: string, checked: boolean }` | `{ items: OutboxItem[] }` / `404` |
| 9 | `GET /api/jobhunt/scout` | ◐ `readScoutLatest()` + parse | — | `ScoutReport` |
| 10 | `GET /api/jobhunt/scout/history` | ✨ | — | `{ sweeps: { file, date, updated }[] }` (from `scout\shortlist-*.md`) |
| 11 | `GET /api/jobhunt/profile?file=<name>` | ✅ `getProfileFile()` (whitelist) | whitelisted name | `{ content: string }` |
| 12 | `GET /api/jobhunt/profile/health` | ✨ | — | `ProfileHealth` (see §3.5) |
| 13 | `POST /api/jobhunt/open` | ✅ `openFile()` | `{ path: string }` | `204` / `400` bad ext or jail / `404` |
| 14 | `GET /api/jobhunt/revision` | ✨ | — | `{ rev: string }` — cheap mtime fingerprint for poll-on-focus |

Deliberately **not** added: no `DELETE` anywhere, no generic write route, no
`PUT /profile`, no route that takes a client-supplied path for *writing*.

Notes per route worth stating precisely:

- **#2 `expect`** is this build's addition over the AgentOS version and is the
  mitigation for risk R1 (concurrent hand-edits). Server flow: re-read the
  file, locate the row by `application_folder`, and if `expect` is present and
  either field differs from disk, return `409` with the current row instead of
  writing. The client sends `expect` on every drag/menu change using the row
  it rendered from; the drawer/board then shows "changed on disk" and
  refreshes rather than silently winning.
- **#2 status validation** must be against the exact enum
  `drafted | contacted | replied | interview | offer | rejected | withdrawn`,
  rejecting anything else with `400` — never write an arbitrary string into
  the CSV.
- **#3** is the workhorse. Default response is **cheap**: tracker rows joined
  with a single `readdirSync` per application folder (existence flags + mtime
  only). The two expensive per-folder reads (`keyword-match.md`,
  `ats-lint-report.md`) are done once and memoized keyed by folder mtime — see
  R9.
- **#5** must reject any extension outside its allowlist with `400` and must
  never be reachable for `.pdf` (that's #6) or for arbitrary binaries.
- **#6** streams with `fs.createReadStream` — no buffering, no new dep. It
  must `statSync` first and `404` cleanly; it must set
  `Content-Disposition: inline` (an `attachment` disposition makes the
  `<iframe>` download instead of render).
- **#13** is ported verbatim including the `spawn("cmd", ["/c","start",'""',abs])`
  argv-array form and its empty-title-placeholder comment. Do not "simplify"
  that `'""'` argument.
- **#14** returns a hash of `(mtimeMs, size)` for `tracker.csv`,
  `outbox\manifest.md`, `scout\latest.md`, and the `applications\` directory
  entry itself. Client compares on window focus and refetches only on change.

### 3.4 WebSocket

Reuse `/ws/apply`. `shared/apply.ts`'s `ApplyServerFrame` union gains one
member in Phase 8:

```ts
| { type: "fs-change"; areas: Array<"tracker" | "outbox" | "scout" | "applications" | "profile">; at: string }
```

Client frames are unchanged (`send` / `interrupt`) — the socket stays
incapable of expressing anything but a chat turn.

### 3.5 Data models (`shared/jobhunt.ts`, new file next to `shared/apply.ts`)

Shapes below are derived from the **actual files on disk**, not assumed.

```ts
export type TrackerStatus =
  | "drafted" | "contacted" | "replied" | "interview"
  | "offer" | "rejected" | "withdrawn";

/** tracker.csv, header order exactly as on disk. All values are raw strings —
 *  numeric columns are strings in the file and stay strings here. */
export interface TrackerRow {
  date_added: string;          // YYYY-MM-DD
  company: string;
  role: string;                // may contain accents and parentheses
  location: string;
  language: string;            // "fr" | "en" in practice, not enforced
  jd_source: string;           // jobs\incoming\<slug>.md
  application_folder: string;  // applications\<slug>   (BACKSLASH separator)
  cv_path: string;
  letter_path: string;
  contacts_found: string;      // numeric-ish string
  outreach_drafted: string;
  outreach_sent: string;
  status: string;              // validated into TrackerStatus at the edge
  last_updated: string;        // YYYY-MM-DD
  notes: string;               // LAST column — may contain unescaped commas
}

/** GET /api/jobhunt/applications — one card on the Kanban. */
export interface ApplicationSummary {
  folder: string;              // basename only, e.g. "acme-dev-fullstack-20260101"
  company: string;
  role: string;
  location: string;
  language: string;
  status: TrackerStatus | "unknown";
  rawStatus: string;           // preserved verbatim when not in the enum
  dateAdded: string;
  lastUpdated: string;
  ageDays: number | null;      // null when the date cell is unparseable
  idleDays: number | null;     // days since last_updated
  contactsFound: number | null;
  outreachDrafted: number | null;
  outreachSent: number | null;
  pendingOutreach: number;     // unchecked outbox lines pointing into this folder
  matchPercent: number | null; // §3.6
  matchSource: "scout" | "keyword-match" | null;
  atsOverall: "pass" | "fail" | null;
  docs: {                      // pure existence flags — cheap readdir
    cvPdf: boolean; cvDocx: boolean; cvMd: boolean;
    letterPdf: boolean; letterDocx: boolean; letterMd: boolean;
    keywordMatch: boolean; atsReport: boolean; contacts: boolean;
    jobDescription: boolean; outreachDrafts: number;
  };
  orphan: "none" | "no-folder" | "no-tracker-row";
  notes: string;
}

export interface ContactRow {
  name: string;                // may literally be "(name unknown)"
  title: string;               // often empty
  email: string;
  confidence: "verified" | "public-listed" | "pattern-guessed" | "unknown";
  source: string;              // a URL, or empty
  notes: string;
}

export interface KeywordRow {
  keyword: string;
  present: "yes" | "partial" | "no";
  notes: string;
}

export interface AtsCheck { file: string; label: string; pass: boolean; detail: string; }
export interface AtsReport {
  files: string[];
  checks: AtsCheck[];
  overall: "pass" | "fail" | null;
  informational: string[];     // the keyword-coverage sanity-check block
}

export interface OutreachDraft {
  relPath: string;
  to: string; toName: string; subject: string;
  attachments: string[];
  language: string;
  confidenceTier: ContactRow["confidence"];
  body: string;                // frontmatter stripped — never concatenated back
  inManifest: boolean; reviewed: boolean;
}

export interface ApplicationDetail {
  summary: ApplicationSummary;
  files: { name: string; relPath: string; ext: string; size: number; mtime: string }[];
  contacts: ContactRow[];
  emailPattern: string | null; // the "Detected email pattern: `{f}{last}`" line
  keywords: KeywordRow[];
  keywordGapsSummary: string;  // the "## Gaps summary" prose block
  ats: AtsReport | null;
  drafts: OutreachDraft[];
  jobDescription: { frontmatter: Record<string, unknown>; body: string } | null;
}

export interface ScoutRow {
  rank: number | null;
  company: string; role: string;
  posted: string;              // raw cell, e.g. "il y a 3 jours" / "hier"
  postedDays: number | null;   // parsed, null when unparseable
  location: string;
  match: string;               // raw cell (often prose)
  matchPercent: number | null; // first \d{1,3}% in the cell
  keyMatches: string[];        // split on ", " with **bold** markers stripped
  gaps: string[];
  sourceUrl: string;
  queued: boolean;             // cell starts with "yes"
  queuedNote: string;          // remainder, e.g. "fetch full text first"
  raw: string[];               // every cell, verbatim, for the unparsed fallback
}

export interface ScoutReport {
  found: boolean;
  updated?: string;            // file mtime, ISO
  sweepDate?: string;          // parsed from the "# Job scout — YYYY-MM-DD" heading
  preamble?: string;           // sources swept / queries / profile basis prose
  rows: ScoutRow[];
  skipped: string[];           // "## Skipped" bullet lines, raw markdown
  notes: string[];             // "## Notes for next sweep" bullets
}

export interface ProfileHealth {
  files: { name: string; exists: boolean; bytes: number; mtime: string | null }[];
  updated: string | null;      // `updated:` from master-profile frontmatter
  sections: { name: string; present: boolean }[];  // H2s found in master-profile.en.md
  skillCount: number | null;   // entries in skills-inventory.yaml
  achievementCount: number | null;
  pendingImports: { relPath: string; mtime: string }[]; // profile\_pending-import-*.md
  languages: string[];         // ["en","fr"] from which master-profile.<lang>.md exist
}

export interface OutboxItem {   // identical to the AgentOS shape — port as-is
  raw: string; checked: boolean; date: string;
  company: string; contact: string; subject: string; draftPath: string;
}
```

### 3.6 Parsing rules grounded in the real files

These are the traps @dev will otherwise hit. Each was confirmed by reading
the actual files, not inferred.

1. **`tracker.csv` last-column commas.** The `notes` column contains
   unescaped commas *and* semicolons *and* accented French. Port
   `splitCsvLine(line, numFields)` verbatim (head columns + last column
   absorbs the rest); never swap in a general CSV parser, and never
   re-quote on write.
2. **Numeric columns are strings.** `Number(row.contacts_found)` on a
   hand-edited empty cell yields `NaN`, which slips straight past `?? 0`.
   Parse via a shared `toInt(s): number | null` that checks
   `Number.isFinite` — this exact class of bug has already bitten this
   codebase family once.
3. **`application_folder` uses a backslash separator** (`applications\<slug>`).
   Key everything by **basename** and normalize separators when matching;
   URL-encode the folder in route params and reject `..` / `/` / `\` in the
   `:folder` param before calling `jailed()` (defense in depth, matching the
   `PATH_TRAVERSAL_RE` stance already in `jobHuntWrite.ts`).
4. **Outbox manifest line format** is
   `[ ] <date> — <company> — <contact> — <subject> — <path.md>` where
   `<subject>` itself frequently contains further ` — ` separators. The
   existing non-greedy regex resolves this correctly by backtracking until
   the final group matches a bare no-space `*.md`. Port it verbatim,
   including the comment; do not "fix" it.
5. **`contacts.md`** starts with a `Detected email pattern: \`{f}{last}\``
   line *before* the table. Rows can have `(name unknown)` as the name and
   empty title/notes cells. Confidence vocabulary is
   `verified` / `public-listed` / `pattern-guessed`; anything else maps to
   `"unknown"` rather than throwing.
6. **`keyword-match.md`** has a three-column table whose middle column takes
   **three** values — `yes`, `no`, and `partial` (all three occur in real
   data). A trailing `## Gaps summary` prose block follows the table and is
   worth surfacing verbatim; it is the honest-gaps statement.
7. **`ats-lint-report.md`** is `### <file>` headings, then lines shaped
   `- [x] PASS: <label> -- <detail>`; parse on the `PASS:`/`FAIL:` token
   rather than the checkbox glyph. There's a trailing informational
   "Keyword coverage sanity check" block (explicitly non-blocking — render it
   as a note, never as a failure) and a final `**Overall: PASS**`.
8. **Outreach drafts** carry frontmatter `to`, `to_name`, `subject`,
   `attachments` (a YAML flow list), `language`, `confidence_tier`. The copy
   action copies **`body` only, never the frontmatter** — the recipient
   address is shown as a copyable chip, separately and deliberately.
9. **Scout table** is 11 pipe-separated columns; cells contain `**bold**`,
   URLs, parentheses, and `⚠` glyphs but (verified) no literal `|`. If a row
   doesn't split into 11 cells, keep it in `raw` and render it as a plain
   text row instead of dropping it. The `match` cell is prose
   (`"~75% (7.5/10 requirement keywords)"`, or `"partial listing (card only)"`
   with no number at all) — extract the first `\d{1,3}%`, else `null`, and
   the radial ring renders an explicit "no score" state rather than 0%.
10. **`posted` is relative French prose** (`"hier"`, `"il y a 3 jours"`).
    Parse `hier → 1`, `aujourd'hui → 0`, `il y a N jours → N`,
    `il y a N semaines → 7N`; anything else → `null` and the badge shows the
    raw string.
11. **Match % is not in `tracker.csv`.** Derive it, and say which source was
    used: prefer a scout row whose company+role match the application
    (case-insensitive, accent-folded); else compute from `keyword-match.md`
    as `(yes + 0.5 × partial) / total`, rounded; else `null`. `matchSource`
    is surfaced in the UI tooltip so a derived number is never mistaken for
    a scraped one.
12. **Everything is UTF-8 with accents.** Read and write with explicit
    `"utf8"`. Verify accented rendering **in the browser**, not in a terminal
    — this codebase family has twice been misled by shell-level mangling of
    accented/backslashed text.

### 3.7 KPI and funnel definitions (be honest about what the data supports)

`tracker.csv` stores **current state only** — there is no status history. So:

- **Total applications** = tracker row count.
- **Awaiting send** = `status === "drafted"`.
- **In flight** = `status ∈ {contacted, replied, interview}`.
- **Response rate** = `(replied + interview + offer) / (contacted + replied +
  interview + offer + rejected)`. Renders `—` when the denominator is 0.
  Tooltip states the formula.
- **Interviews reached** = `status ∈ {interview, offer}`.
- **Pending outreach drafts** = outbox items with `checked === false`.
- **Scout matches** = rows in the latest sweep with `postedDays ≤ 7`;
  the tile label carries the sweep date so it never implies "this week"
  when the last sweep is old, and turns amber when the sweep is >7 days old.
- **Funnel** = "current status is at or beyond stage N" over the ordered
  stages `drafted < contacted < replied < interview < offer`. `rejected` and
  `withdrawn` are **excluded** from the stage bars and shown as separate
  "exited" counters, because a rejection tells us nothing about which stage
  it exited from. The funnel card carries a one-line footnote saying so.
- **Activity** = per-week counts derived from `date_added` (new) and
  `last_updated` (touched) over the last 12 weeks. Two series, one
  sparkline, honest label: "derived from the tracker's two date columns".

**Needs-attention rules** (each row links to the view that resolves it):

| Rule | Condition | Action link |
|---|---|---|
| Draft not sent | unchecked outbox item | Outbox |
| Follow-up due | `status === "contacted"` and `idleDays > 7` | Application drawer |
| Stalled draft | `status === "drafted"` and `ageDays > 3` | Pipeline card |
| Untracked folder | folder on disk with no tracker row | Application drawer (read-only) |
| Missing folder | tracker row whose folder doesn't exist | Overview note |
| ATS failure | `atsOverall === "fail"` | Drawer → ATS tab |
| Queued but not run | scout row `queued === true` with no matching application | Scout card |
| CV import pending | any `profile\_pending-import-*.md` exists | Profile |
| Stale sweep | latest sweep older than 7 days | Scout → Run sweep |

Follow-up nudge copy must say **"copy the draft and send it yourself"** —
never "send".

---

## 4. File structure

```
ApplyAssistant/
├─ UI-OVERHAUL-PLAN.md              # this doc (scrubbed; see header note)
├─ shared/
│  ├─ apply.ts                      # unchanged + one new ApplyServerFrame member (Ph8)
│  └─ jobhunt.ts                    # NEW — every type in §3.5
├─ server/
│  └─ src/
│     ├─ index.ts                   # + register routes/jobhunt.ts; nothing else moves
│     ├─ config.ts                  # unchanged — jailed() is already the right primitive
│     ├─ routes/
│     │  └─ jobhunt.ts              # NEW — the 14 routes, thin: validate → service → reply
│     └─ services/
│        ├─ jobHuntRead.ts          # NEW — tracker/outbox/files/scout/profile readers
│        ├─ jobHuntParse.ts         # NEW — PURE parsers (csv line, md table, ats, scout)
│        ├─ jobHuntWrite.ts         # existing + updateTrackerRow + toggleOutboxItem
│        ├─ openFile.ts             # NEW — ported verbatim from AgentOS
│        ├─ applications.ts         # NEW — summary aggregation + mtime memo cache
│        ├─ watch.ts                # NEW (Phase 8) — chokidar → debounced WS broadcast
│        ├─ pdf.ts, classify.ts     # unchanged
│        └─ __tests__/parse.test.ts # node --test, synthetic fixtures only
└─ client/
   └─ src/
      ├─ main.tsx
      ├─ App.tsx                    # shell only: providers + router + <AppShell>
      ├─ router.ts                  # NEW — hash router (§5.1)
      ├─ lib/
      │  ├─ api.ts                  # one typed function per route, no ad-hoc fetch elsewhere
      │  ├─ useResource.ts          # fetch + loading/error + revalidate
      │  ├─ dates.ts                # daysSince / weekBuckets / relative labels (NaN-guarded)
      │  ├─ num.ts                  # toInt / pct / clamp (Number.isFinite guards)
      │  ├─ cx.ts                    # 5-line className joiner (instead of clsx)
      │  ├─ clipboard.ts            # copy + "copied" feedback
      │  ├─ useFocusTrap.ts         # drawer + palette
      │  ├─ useReducedMotion.ts
      │  ├─ useHotkeys.ts           # ⌘K / Ctrl+K, Esc, ?, g-then-key nav
      │  └─ useExitTransition.ts    # 150ms unmount delay (replaces framer-motion exits)
      ├─ data/
      │  └─ JobHuntProvider.tsx     # cache of status/tracker/apps/outbox/scout + refreshAll()
      ├─ assistant/
      │  ├─ AssistantProvider.tsx   # chat session state, lifted out of ApplyChat
      │  ├─ applyWs.ts              # existing, unchanged
      │  └─ prompts.ts              # buildPipelinePrompt / buildScoutPrompt / buildQueuePrompt
      ├─ components/
      │  ├─ shell/{AppShell,NavRail,TopBar,ConfigGate,Toasts,CommandPalette}.tsx
      │  ├─ ui/{Card,StatTile,Badge,StatusBadge,StatusMenu,Chip,Button,IconButton,
      │  │      Drawer,Tabs,Skeleton,EmptyState,ErrorState,CopyButton,Markdown}.tsx
      │  ├─ charts/{Funnel,Sparkline,RadialScore,MiniBars}.tsx      # hand-rolled SVG
      │  ├─ overview/{OverviewView,KpiRow,FunnelCard,ActivityCard,NeedsAttention}.tsx
      │  ├─ pipeline/{PipelineView,StatusColumn,ApplicationCard,BoardDnd,NarrowBoard}.tsx
      │  ├─ application/{ApplicationDrawer,DocsTab,PdfPreview,ContactsTab,
      │  │               KeywordTab,AtsTab,OutreachTab}.tsx
      │  ├─ scout/{ScoutView,ScoutCard,SweepBar,SkippedList,SweepHistory}.tsx
      │  ├─ outbox/{OutboxView,OutboxRow,DraftPreview}.tsx
      │  ├─ profile/{ProfileView,ProfileHealthCard,PendingImports}.tsx
      │  ├─ intake/{IntakeView,PdfDropZone}.tsx     # existing PdfDropZone, restyled
      │  └─ assistant/{AssistantDock,ChatMessages,ToolCallBlock,Composer,QuickActions}.tsx
      └─ styles/
         ├─ tokens.css              # §7 — the design system, single source of truth
         ├─ base.css                # reset, typography, focus ring, reduced-motion block
         ├─ shell.css, overview.css, pipeline.css, drawer.css,
         ├─ scout.css, outbox.css, profile.css, assistant.css, markdown.css
```

`client/src/components/apply/*` is **moved**, not deleted:
`ApplyChat.tsx` → `components/assistant/*` (split), `PdfDropZone.tsx` →
`components/intake/`, `applyWs.ts` → `assistant/`. `ApplyAssistant.tsx`'s
config-gate logic becomes `shell/ConfigGate.tsx` and wraps every view.

---

## 5. Client architecture

### 5.1 Routing — hand-rolled hash router

**Recommendation: write it (~50 LOC), don't install `react-router-dom`.**

Requirements are: 7 top-level views, one deep-linkable overlay
(`#/pipeline?app=<folder>`), back-button support, and survive a reload. That
is `location.hash` + a `hashchange` listener + a tiny parse function.
`react-router-dom@6` is ~17 kB gz and brings loaders, nested route matching,
and a data-router mental model we'd use ~5% of. Rejected.

```ts
export type Route =
  | { view: "overview" }
  | { view: "pipeline"; app?: string }
  | { view: "scout" }
  | { view: "outbox"; draft?: string }
  | { view: "profile"; file?: string }
  | { view: "intake" }
  | { view: "assistant" };
```

`#/pipeline?app=acme-dev-fullstack-20260101` opens the board with the drawer
already open on that application — which also makes the "needs attention"
links and command-palette results trivially implementable as `navigate()`
calls. Unknown hash → Overview.

### 5.2 Data fetching — plain fetch + `useResource` + one provider

**Recommendation: no query library.**

TanStack Query is ~13 kB gz of cache-key/stale-time/mutation machinery built
for multi-consumer server state with unpredictable invalidation. Here there
are ~8 read endpoints, a single consumer per endpoint, and one source of
truth (the local filesystem) that we always want to refetch *wholesale* after
any change. What we actually need from it is two behaviors — refetch on focus
and stale-while-revalidate — and both are ~10 lines each.

```ts
// lib/useResource.ts
function useResource<T>(key: string, fetcher: () => Promise<T>, deps: unknown[] = []):
  { data: T | undefined; error: string | null; loading: boolean; reload: () => void }
```

`data/JobHuntProvider.tsx` owns the four shared resources (`status`,
`applications`, `outbox`, `scout`) plus:

- `refreshAll()` — called by (a) the manual refresh button, (b) any
  successful write, (c) `turn-complete` from the chat driver, (d) window
  `focus`/`visibilitychange` **if** `GET /api/jobhunt/revision` changed,
  (e) Phase 8's `fs-change` frame.
- `patchStatus(folder, next, expect)` — optimistic update, rollback + toast
  on failure, `409` handled as "changed on disk" + forced refresh.
- Per-application detail is *not* in the provider: the drawer fetches
  `GET /api/jobhunt/applications/:folder` on open with its own `useResource`,
  because it's the only consumer and it's the one expensive read.

Requests that can race (fast repeated drags) are keyed by folder and
last-write-wins with an `AbortController` per in-flight fetch.

### 5.3 Component tree

```
<App>
 ├ <JobHuntProvider>            data cache + refresh bus
 │  └ <AssistantProvider>       chat session, WS subscription, busy state
 │     └ <AppShell>
 │        ├ <NavRail/>                     7 items + refresh + assistant toggle
 │        ├ <TopBar/>                      view title, breadcrumb, last-refresh, ⌘K hint
 │        ├ <ConfigGate>                   renders the "not configured" card instead of any view
 │        │  └ {route.view === "overview" && <OverviewView/>}
 │        │     · <KpiRow>  <StatTile ×6>
 │        │     · <FunnelCard>  <Funnel/>            (SVG)
 │        │     · <ActivityCard> <Sparkline/>        (SVG)
 │        │     · <NeedsAttention> → navigate()
 │        │  … <PipelineView/>
 │        │     · <BoardDnd>  (DndContext)
 │        │        └ <StatusColumn ×7>
 │        │           └ <ApplicationCard>  ← draggable + click → drawer
 │        │              · <StatusBadge> <RadialScore/> <Chip×n> <StatusMenu/>
 │        │     · <ApplicationDrawer>   (route-driven, ?app=)
 │        │        └ <Tabs> Docs | Contacts | Keywords | ATS | Outreach
 │        │  … <ScoutView/>, <OutboxView/>, <ProfileView/>, <IntakeView/>
 │        ├ <AssistantDock/>              collapsible right panel, mounted once
 │        ├ <CommandPalette/>             ⌘K, portal
 │        └ <Toasts/>                     aria-live=polite
```

The Assistant is mounted **once** at shell level and is never unmounted by
navigation — a CLI turn started on the Scout view keeps streaming while the
user reads the Pipeline. This is the reason chat state moves out of
`ApplyChat` into `AssistantProvider`.

### 5.4 Assistant: tool-call rendering

Today every tool event renders as `<details>tool: X` / `tool result` with raw
JSON. Replace with a `ToolCallBlock` that:

- pairs `tool-use` with its `tool-result` by `id` into a single collapsed row:
  `▸ [icon] Read  applications\…\keyword-match.md   ✓ 1.2 kB`;
- derives a human summary per tool name — `Read`/`Write`/`Edit` → the file's
  path relative to the job-hunt root; `Bash` → the first line of the command;
  `Glob`/`Grep` → the pattern; unknown tools → the tool name plus a key count;
- streams a "running…" state between the two events (pulse dot; static under
  reduced motion);
- shows errors with the `--red` surface treatment already used by
  `.apply-error`, expanded by default rather than collapsed;
- keeps the raw input/result behind the disclosure triangle — nothing is
  hidden, just not shouted.

Quick actions stay prompt-construction only: `runPipeline`, `runScout`, and a
new `queueScoutRow` (anchors the root, names the skill, passes the source
URL). All of them go through the existing single-flight WS. **No new
server-side spawn path is introduced anywhere in this plan** apart from the
already-existing, extension-allowlisted `openFile`.

---

## 6. Dependencies — recommendations and rejections

Client currently: `react`, `react-dom`. Every addition below is a deliberate
choice; sizes are min+gzip, approximate, and should be re-checked by @dev
against the installed version with `npx vite build --mode production` +
`rollup-plugin-visualizer` if any of them looks surprising.

### ACCEPT (4 client deps, 1–2 server deps)

| Package | Version | ~gz | Why it wins |
|---|---|---|---|
| `@dnd-kit/core` | `^6.1` | ~12 kB | Kanban DnD with a **built-in `KeyboardSensor` and ARIA live announcements** — the deciding factor, since our a11y requirement makes a keyboard path mandatory. Pointer/touch/mouse sensors, collision detection, and `activationConstraint` (needed so a click-to-open-drawer never becomes an accidental drag) all come free. |
| `lucide-react` | `^0.4xx` | ~0.5 kB/icon | Per-icon ESM modules; ~25–30 icons ≈ 12 kB. Consistent stroke weight matches the existing thin dark aesthetic. **Import deep** (`lucide-react/icons/…` or named imports with Vite's `optimizeDeps.include`) so the dev server doesn't crawl the barrel file. |
| `react-markdown` | `^9` | ~30 kB | Profile, job descriptions, ATS reports, letters, scout prose — all real GFM with accented French. Rendering it by hand is a bug farm. **Lazy-loaded** via `React.lazy` so it lands in a separate chunk only when a markdown surface opens. |
| `remark-gfm` | `^4` | ~25 kB | Required for tables — which is most of what we render. Same lazy chunk. |
| `gray-matter` (server) | `^4.0.3` | n/a | Outreach draft frontmatter; server-only, zero client cost; already the proven choice in the sibling port. |
| `chokidar` (server, Phase 8, optional) | `^4` | n/a | Reliable recursive watching on Windows; only if the poll-on-focus fallback proves insufficient in real use. |

Net initial-bundle growth over today: roughly **+25–30 kB gz**
(dnd-kit + icons), with markdown's ~55 kB deferred to a second chunk. React
itself is ~45 kB gz, so this stays a small app.

### REJECT (with reasons)

| Rejected | ~gz | Why not |
|---|---|---|
| `framer-motion` | ~34 kB | Everything we need — drawer slide-in, card lift on drag, tile count-up, funnel bar grow, chip fade — is a CSS `transition` or one `@keyframes`. The single genuine gap is **exit** animations, solved by a 15-line `useExitTransition` hook that delays unmount by `--dur-base`. Not worth a third of React's weight. |
| `recharts` | ~95 kB (+d3) | Brings axes, legends, responsive containers, tooltips, and a d3 dependency tree for three bespoke visuals that have no axes and no legends. |
| `visx` | ~20–40 kB for shape+scale+group | Better than recharts, but we'd use `scaleLinear` and `<path>` — i.e. the two things that are 6 lines of arithmetic each. |
| **Hand-rolled SVG charts** | 0 | **WINNER.** Funnel = 5 `<rect>`s with widths proportional to counts. Sparkline = one `<polyline>` from a `points` string. Radial ring = two `<circle>`s with `stroke-dasharray`/`stroke-dashoffset` (~20 lines, the standard trick). Mini bars = `<rect>`s. All of it is ~150 lines total, fully themeable with our CSS variables, and trivially made accessible with `role="img"` + `<title>`. |
| HTML5 native drag-and-drop | 0 | No keyboard support, no touch support, an un-styleable drag image, `dragover` event storms, and Firefox/Windows quirks around `dataTransfer`. The a11y requirement alone disqualifies it. |
| Hand-rolled pointer-events DnD | 0 | ~200 lines plus we'd own auto-scroll, collision detection, and the entire keyboard + announcement layer. More code than the 12 kB it saves. |
| `pdfjs-dist` in the client | ~330 kB + worker | We'd be reimplementing a viewer the browser already ships. (Note: `pdfjs-dist` is already a **server** dep for text extraction — that is a different, non-shared use.) |
| `react-router-dom` | ~17 kB | §5.1 — 50 lines of hash routing covers the whole requirement. |
| `@tanstack/react-query` | ~13 kB | §5.2 — one FS source of truth, wholesale refresh, two behaviors we can write. |
| `zustand` | ~1.2 kB | Tiny, but it's a third state concept for two context providers that already work. Revisit only if prop-drilling actually appears. |
| `clsx` / `classnames` | ~0.5 kB | A 5-line `cx()` in `lib/cx.ts`. |
| `date-fns` / `dayjs` | ~7–20 kB | We need "days between two `YYYY-MM-DD` strings" and week bucketing — ~25 lines in `lib/dates.ts`, with the `Number.isFinite` guard that a hand-edited date cell demands. |
| Tailwind / any CSS framework | build cost | The existing token-based CSS *is* the design the user liked; a utility framework would rewrite every existing class for no functional gain. |
| `react-window` / virtualization | ~6 kB | Realistic scale is tens of applications, not thousands. Revisit past ~300 cards. |

---

## 7. Design system

Keep the established dark look — same token *values* for everything that
already exists — and extend it into a full system in `styles/tokens.css`.

### 7.1 Surfaces & elevation

```css
:root {
  /* existing — unchanged values */
  --bg:            #0e1116;   /* app canvas */
  --bg-raised:     #161b23;   /* cards, panels */
  --bg-hover:      #1d242f;   /* hover / active row */
  --border:        #2a3341;
  --text:          #d7dee8;
  --text-dim:      #8b96a5;
  --accent:        #4fc1ff;
  --green:         #3fb68b;
  --amber:         #e5b567;
  --purple:        #b18aff;
  --red:           #ef6363;
  --mono: "Cascadia Code", "JetBrains Mono", Consolas, monospace;

  /* new surfaces */
  --bg-sunken:     #0a0d12;   /* code blocks, inset wells, board gutter */
  --bg-overlay:    #1a212b;   /* drawer, palette, popover (above the page) */
  --bg-scrim:      rgba(6, 9, 13, 0.66);
  --border-subtle: #212936;
  --border-strong: #3a4655;
  --text-faint:    #6b7686;   /* de-emphasized meta, never body copy */

  --shadow-1: 0 1px 2px rgba(0,0,0,.40);
  --shadow-2: 0 4px 12px rgba(0,0,0,.45);
  --shadow-3: 0 16px 40px rgba(0,0,0,.55);
  --ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
}
```

Elevation rule: canvas → `--bg`; anything card-like → `--bg-raised` +
`--border` + `--shadow-1`; anything floating (drawer, palette, menu, toast) →
`--bg-overlay` + `--border-strong` + `--shadow-3` over a `--bg-scrim`
backdrop. Never more than two elevation steps in one composition.

### 7.2 Spacing, radii, typography

```css
:root {
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px;

  --r-sm: 4px; --r-md: 6px;  /* --r-md matches today's .btn */
  --r-lg: 10px; --r-xl: 14px; --r-full: 999px;

  --fs-micro: 10.5px;  /* uppercase eyebrow labels, letter-spacing .5px */
  --fs-meta:  11.5px;  /* card meta, chip text */
  --fs-sm:    12.5px;  /* secondary body, table cells */
  --fs-body:  14px;    /* base — unchanged from today */
  --fs-lg:    16px;    /* card titles */
  --fs-xl:    20px;    /* view titles / today's h1 */
  --fs-kpi:   28px;    /* KPI numerals, font-variant-numeric: tabular-nums */

  --lh-tight: 1.25; --lh-body: 1.5; --lh-prose: 1.65;
  /* weights: 400 body, 500 emphasis/labels, 600 titles. Nothing else. */
}
```

Everything numeric that can change (KPIs, counts, percentages, day counts)
uses `font-variant-numeric: tabular-nums` so values don't jitter on refresh.

### 7.3 Status colors — concrete mapping to the tracker enum

```css
:root {
  --st-drafted:   #8b96a5;  /* = --text-dim: written but nothing sent yet */
  --st-contacted: #4fc1ff;  /* = --accent:  out the door, awaiting reply */
  --st-replied:   #b18aff;  /* = --purple:  a human responded */
  --st-interview: #e5b567;  /* = --amber:   active, needs preparation */
  --st-offer:     #3fb68b;  /* = --green:   success */
  --st-rejected:  #ef6363;  /* = --red:     closed, negative */
  --st-withdrawn: #5b6675;  /* muted slate — closed by us, distinct from drafted */
  --st-unknown:   #6b7686;  /* a status string not in the enum (hand-edited) */
}
```

Each status derives a surface and border with the `color-mix` pattern the
codebase already uses in `.apply-error` / `.apply-chat-banner`:

```css
.status-contacted {
  --st: var(--st-contacted);
  color: var(--st);
  background: color-mix(in srgb, var(--st) 12%, var(--bg-raised));
  border-color: color-mix(in srgb, var(--st) 45%, var(--border));
}
```

The Kanban column header, the card's left edge (3px accent bar), the status
badge, and the funnel segment for a given status all read from the same
`--st-*` token, so status colour is defined exactly once.

**Other semantic mappings:**

| Domain | Value | Colour | Extra affordance |
|---|---|---|---|
| Contact confidence | `verified` | `--green` | badge text "verified" |
| | `public-listed` | `--accent` | badge text |
| | `pattern-guessed` | `--amber` | badge text + ⚠ icon + "verify before use" tooltip |
| | `unknown` | `--text-faint` | badge text |
| Keyword match | `yes` | `--green` chip | leading `✓` |
| | `partial` | `--amber` chip | leading `~` |
| | `no` (gap) | outlined `--red` chip on `--bg-sunken` | leading `✗` |
| ATS check | pass | `--green` | `✓` |
| | fail | `--red` | `✗`, and the check expands by default |
| Scout posted age | ≤2 days | `--green` | "2d ago" |
| | 3–7 days | `--accent` | |
| | >7 days / unknown | `--text-dim` | raw string shown when unparsed |
| Match score ring | ≥70 | `--green` | |
| | 45–69 | `--amber` | |
| | <45 | `--text-dim` | |
| | `null` | dashed grey ring | label "no score" |

**Colour is never the only signal** — every badge carries its word, every
chip carries a glyph, every ring carries its number or "no score".

### 7.4 Motion

```css
:root {
  --dur-fast: 120ms;  /* hover, press, chip toggle */
  --dur-base: 180ms;  /* drawer, tab switch, dock collapse */
  --dur-slow: 320ms;  /* funnel bar grow, KPI count-up, sparkline draw */
  --ease-out: cubic-bezier(.2,.8,.3,1);
  --ease-in-out: cubic-bezier(.4,0,.2,1);
}
```

Inventory: drawer slides from the right (`translateX(24px)` + opacity,
`--dur-base`); cards lift on drag (`--shadow-2`, `scale(1.02)`,
`--dur-fast`); columns highlight their drop zone with a border/background
change only (no layout shift); funnel bars animate width once on mount;
KPI numbers count up over `--dur-slow`; the assistant's "running" tool row
pulses.

Reduced motion is handled in **two** places, because a global CSS override
alone doesn't stop JS-driven animation:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important; animation-iteration-count: 1 !important;
    transition-duration: 1ms !important; scroll-behavior: auto !important;
  }
}
```

plus `useReducedMotion()` which: skips the count-up (render the final number
immediately), skips the sparkline draw-in, sets dnd-kit's `dropAnimation` to
`null`, replaces the pulse with a static dot, and switches the chat's
existing `scrollIntoView({ behavior: "smooth" })` to `"auto"` (that call is
in today's `ApplyChat` and must be updated during the move).

---

## 8. Accessibility & responsiveness

### 8.1 Kanban keyboard path (mandatory, two independent mechanisms)

1. **dnd-kit `KeyboardSensor`** — `Tab` to a card, `Space`/`Enter` to pick up,
   `←`/`→` to move between status columns, `↑`/`↓` within a column,
   `Space`/`Enter` to drop, `Esc` to cancel. Custom `announcements` strings
   ("Picked up Acme — Full-stack developer, currently drafted", "Moved to
   contacted", "Dropped in contacted", "Cancelled") feed dnd-kit's built-in
   `aria-live` region.
2. **A per-card `StatusMenu`** (a real `<select>`, or a listbox-pattern menu)
   in the card's footer, issuing the same `patchStatus()` call. This is not a
   fallback bolted on for compliance — it's the faster path for anyone using
   a keyboard, and it is the **only** status-change mechanism on narrow
   layouts where the board collapses.

Cards are focusable elements inside `role="list"` columns with
`role="listitem"`; the column header carries
`aria-label="Contacted, 3 applications"`. Clicking a card opens the drawer;
`activationConstraint: { distance: 6 }` on the PointerSensor guarantees a
click is never swallowed by a drag.

### 8.2 Drawer focus management

`role="dialog" aria-modal="true"` labelled by the drawer's `<h2>`. On open:
remember the trigger element, move focus to the drawer heading (`tabIndex=-1`),
trap Tab within the drawer (`useFocusTrap`), mark the shell container
`inert`/`aria-hidden`, and lock body scroll. On close (Esc, scrim click, or
close button): restore focus to the exact card that opened it. Because the
drawer is route-driven (`?app=`), browser Back also closes it — and must run
the same restore path.

The command palette uses the same trap plus `role="listbox"`/`role="option"`
with `aria-activedescendant` (arrow keys move the highlight, focus stays in
the input).

### 8.3 Other a11y specifics

- Focus ring: `box-shadow: var(--ring)` on `:focus-visible` for every
  interactive element — no `outline: none` without a replacement anywhere.
- Every icon-only button gets an `aria-label`; the nav rail keeps visible
  text labels at ≥1100px and uses `aria-label` + tooltip when collapsed.
- SVG charts: `role="img"` with `aria-label` summarizing the values
  ("Funnel: 12 drafted, 8 contacted, 3 replied, 1 interview, 0 offers"); the
  funnel additionally renders its numbers as text.
- Toasts live in a single `aria-live="polite"` region; status writes announce
  "Status updated to contacted" (and errors announce via `role="alert"`).
- Tables (contacts, keywords) are real `<table>` with `<th scope="col">` —
  not div grids.
- Contrast: `--text` on `--bg-raised` ≈ 11:1; `--text-dim` on `--bg-raised`
  ≈ 6.4:1 — fine for meta text, but body copy stays `--text`, and
  `--text-faint` is restricted to non-essential meta. Status colours are used
  for *borders/backgrounds/icons plus text at ≥12.5px*, all against dark
  surfaces where they measure ≥4.5:1; verify with a contrast checker when
  `--st-withdrawn` is used as text.
- Language: the data is bilingual FR/EN. Set `lang="fr"` on containers
  rendering French content (drafts, letters, JD text) so screen readers use
  the right voice — cheap and genuinely correct here.

### 8.4 Responsive degradation

| Width | Layout |
|---|---|
| ≥1400px | Nav rail (200px, icons + labels) · content · assistant dock (380px, resizable) |
| 1100–1400px | Rail collapses to 56px icons-only; dock still docked but 320px |
| 900–1100px | Dock becomes an overlay sheet (toggle button in TopBar); content full width |
| 760–900px | Kanban switches to horizontal scroll with `scroll-snap-type: x mandatory`, one column ≈ 85vw; drawer becomes full-width |
| <760px | Nav rail becomes a bottom/top tab strip; **Kanban switches to `NarrowBoard`** — a single-column, collapsible-by-status list where DnD is disabled entirely and status changes go through `StatusMenu`; KPI tiles go 2-up then 1-up via `repeat(auto-fit, minmax(160px, 1fr))` |

Drawer is `width: min(720px, 100vw)`. PDF preview keeps a 3:4 aspect ratio
and collapses to a "open in default app" button below 600px of available
width where an embedded viewer is unusable.

---

## 9. Build order

Each phase is independently runnable via `npm run dev` at the repo root and
has a concrete verification step. Order is chosen so the biggest visible win
(Overview) lands as early as the data layer allows, and so the existing,
already-working features are protected by a regression check in Phase 0.

### Phase 0 — Shell, tokens, and a non-destructive move (½ day)

- `styles/tokens.css` + `base.css` per §7; keep every existing token value.
- `router.ts`, `AppShell`, `NavRail`, `TopBar`, `ConfigGate`, `Toasts`.
- Move `components/apply/*` → `components/intake/` + `components/assistant/`;
  lift chat state into `AssistantProvider`; render the existing drop zone as
  the **Intake** view and the existing chat in the **dock**.
- Stub the other five views with `EmptyState` placeholders.

**Verify:** with a real `.env`, upload a PDF and route it (JD *and* CV path),
then run one real CLI turn from the dock — i.e. prove the pre-existing
features still work end-to-end after the move, not just that it compiles.
Reload on `#/scout` and land on Scout. Unset `JOB_HUNT_ROOT` → every view
shows the not-configured card, nothing throws.

### Phase 1 — Read-only server + typed client API (1 day)

- `shared/jobhunt.ts`; `services/jobHuntParse.ts` (pure) + `jobHuntRead.ts` +
  `applications.ts`; `routes/jobhunt.ts` with routes #1, #3–#7, #9–#12, #14.
- `node --test` unit tests for every parser against **synthetic** fixtures
  that reproduce the real shapes: a CSV row whose notes contain commas and
  accents; a manifest line whose subject contains an embedded ` — `; a
  keyword table with all three of yes/partial/no; an ATS report with a FAIL;
  a scout row with no percentage.
- `lib/api.ts` + `useResource` + `JobHuntProvider`.

**Verify:** `curl` each route against the real folder and eyeball the JSON
against the files. Jail tests: `GET /api/jobhunt/file?path=..\..\..\Windows\win.ini`
→ 400; `?path=` a `.exe` → 400; `GET /api/jobhunt/profile?file=notes.md` →
400; `PATCH …/tracker/..%5C..%5Cfoo` → 400. Confirm zero writes occurred
(compare `tracker.csv` mtime before/after the whole phase).

### Phase 2 — Overview (highest-value visible win) (1 day)

KPI tiles, hand-rolled `Funnel`, `Sparkline`, `NeedsAttention`.

**Verify:** hand-compute the expected KPI values from `tracker.csv` and
`outbox\manifest.md` and check every tile matches. Confirm the response-rate
tile shows `—` (not `NaN`, not `0%`) when the denominator is zero, and that a
deliberately blanked date cell yields "unknown age", not `NaN days`.

### Phase 3 — Pipeline board, read-only + `StatusMenu` writes (1 day)

Columns, `ApplicationCard`, `RadialScore`, `StatusMenu` → `PATCH` with
`expect`, optimistic update, undo toast, 409 handling.

**Verify:** take a byte-level copy of `tracker.csv`; change a status via the
menu; diff — exactly one line changed, exactly two cells (`status`,
`last_updated`), notes' commas and accents intact; change it back; confirm
byte-identical to the copy. Then edit the same row in a text editor while the
UI is open and change status in the UI → expect a 409 and a "changed on disk"
message, **not** a clobber.

### Phase 4 — Drag and drop (½ day)

`@dnd-kit/core` with Pointer + Keyboard sensors, `activationConstraint`,
custom announcements, drop-zone styling.

**Verify:** move a card between three columns using **only** the keyboard,
with the browser's screen-reader/announcement output visible; confirm the
same CSV-diff discipline as Phase 3; confirm a plain click still opens the
drawer and never fires a status change; toggle OS "reduce motion" and confirm
no drop animation.

### Phase 5 — Application drawer (1–1.5 days)

Tabs: Docs (file list + `PdfPreview` for `cv.pdf`/`letter.pdf`), Contacts
(table + tier badges + copy-email), Keywords (matched/gap chips + gaps
summary), ATS (checks + informational block), Outreach (drafts, copy body,
open attachments).

**Verify:** both PDFs render inline in the iframe; "copy body" pastes the
draft body with **no frontmatter** (paste into a scratch editor and look);
"open attachment" launches the OS default app (check the process actually
started, not just that the request returned 204); focus is trapped, Esc
closes, focus returns to the originating card; browser Back closes the
drawer.

### Phase 6 — Scout, Outbox, Profile (1 day)

Scout cards with radial rings + posted-age badges + chips + "queue this" +
"Run sweep"; Outbox rows with copy/toggle/open; Profile with lazy
`react-markdown` + `ProfileHealth` + pending-import list.

**Verify:** toggle a manifest checkbox, confirm only that line's `[ ]` → `[x]`
changed and the file is otherwise byte-identical, then toggle back and
byte-compare. Grep the whole diff for any write path to `master-profile`,
`achievement-bank`, or `skills-inventory` — must be zero. Grep for
`smtp|nodemailer|mailto:|sendmail|sendgrid` across `server/src`, `client/src`,
`shared` — must be zero.

### Phase 7 — Assistant dock + command palette + tool-call rendering (1 day)

`ToolCallBlock` pairing, streaming states, dock resize/collapse,
`CommandPalette` (navigate, open application by company, run sweep, run
pipeline, refresh, toggle dock).

**Verify:** start a real CLI turn from the Scout view, navigate to Pipeline
mid-turn, confirm the stream continues and completes in the dock; confirm the
single-flight guard still surfaces "a turn is already running"; confirm
`turn-complete` triggers `refreshAll()` and the board reflects any files the
turn wrote; ⌘K opens/closes, arrow+enter navigates, Esc restores focus.

### Phase 8 — Freshness (½ day, optional)

Poll-on-focus via `/api/jobhunt/revision` ships in Phase 1 and is the
baseline. Only if it proves insufficient: `services/watch.ts` with chokidar
(300 ms debounce, ignore `~$*`, `*.tmp`, `.git`) broadcasting `fs-change` on
the existing `/ws/apply`.

**Verify:** edit `tracker.csv` in an external editor with the UI open and
idle; the board updates within ~1 s with no reload and no lost in-flight
edit.

---

## 10. Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | **The user hand-edits `tracker.csv` (or has it open in Excel) while the UI writes** — a naive write clobbers their edit. | High — this genuinely happens | Never write from cached client state: every write is a fresh read-modify-write of the file, touching only the matched line. The `expect: { status, last_updated }` guard makes a stale write a `409` instead of a clobber. The UI treats 409 as "changed on disk", refreshes, and re-shows the card with the disk value. Excel's exclusive lock surfaces as an EBUSY/EPERM → return `409` with an actionable message ("tracker.csv is locked by another program"), never a 500. |
| R2 | **A slipped drag sets the wrong status.** | Medium | `activationConstraint: { distance: 6 }` so clicks aren't drags; large drop zones; every status change raises a toast with a 5-second **Undo** that issues the inverse `PATCH`; `last_updated` is the only collateral change and is itself restored by the undo. Statuses are validated against the enum server-side, so a bad drag can never write garbage. |
| R3 | **CSV corruption on rewrite** (quoting, EOL, encoding). | Medium if careless | Port `splitCsvLine` + `detectEol` verbatim; reconstruct only the matched line by joining the same split; write `utf8`; never introduce quoting. Unit test round-trips a row containing commas, semicolons, and accents. Phase-3 verification is an explicit byte-compare after a change-and-revert. |
| R4 | **PDF preview blocked or blank** (viewer-less browser, wrong `Content-Disposition`, extension interference). | Medium | Serve `Content-Type: application/pdf` + `Content-Disposition: inline` + `Cache-Control: no-store`, same-origin through the existing Vite proxy (so no framing/CSP issue). `PdfPreview` sets a 3 s load timeout and an `onError` handler; on failure it swaps to a fallback card with "Open in default app" (`POST /api/jobhunt/open`) and a direct download link. **Do not** "fix" this by adding client-side pdf.js. |
| R5 | **Stale UI after a CLI turn writes files** — the whole point of the app is to reflect what the pipeline just did. | High | Layered: (a) `refreshAll()` on `turn-complete`; (b) refetch on window focus / `visibilitychange`, gated by the cheap `/api/jobhunt/revision` fingerprint; (c) a visible "last refreshed 12s ago" + manual refresh in the TopBar so the user is never guessing; (d) Phase 8 chokidar → `fs-change` over the existing WS if (a)–(c) prove insufficient. |
| R6 | **Accent/encoding corruption** in French company names, roles, and letter bodies. | Medium | Explicit `"utf8"` on every read/write; verification is done **in the browser**, not in a terminal — this codebase family has twice been misled by shell-level mangling of accented and backslashed text. Accent-folding for matching (scout ↔ application) reuses the existing `stripCombiningMarks` char-code implementation; do not replace it with a regex range. |
| R7 | **Path handling**: `application_folder` uses `\`, folders can contain `&`, `(`, `)`; a folder name in a URL param is attacker-adjacent input. | Medium | Match by basename with normalized separators; `encodeURIComponent` on the client; reject `..`/`/`/`\` in `:folder` **before** `jailed()`; keep `openFile`'s argv-array `spawn` (never a shell string) and its extension allowlist exactly as ported. |
| R8 | **Personal data leaking into this repo** — fixtures, screenshots, plan docs. | Medium, and previously realized | No file is ever copied out of job-hunt into this tree; all test fixtures are synthesized; this plan uses placeholders only; before any commit, run `git status` (not just `git diff`) and grep the **untracked** set too. Consider adding `UI-OVERHAUL-PLAN.md` to `.gitignore` if it ever gains real examples. |
| R9 | **`GET /api/jobhunt/applications` gets slow** — it touches every application folder and, for match %, reads `keyword-match.md` per folder. | Low now, grows | Default response uses `readdirSync` existence flags only; per-folder derived data (match %, ATS overall) is memoized keyed by `(folder, dir mtimeMs)` and recomputed only on change; `?refresh=1` busts it. Revisit virtualization past ~300 applications. |
| R10 | **`NaN` from hand-edited numeric/date cells** propagating into layout (`width: NaN%`) or labels. | Medium | All coercion goes through `lib/num.ts`/`lib/dates.ts` helpers that check `Number.isFinite` and return `null`; every consumer renders an explicit "—"/"unknown" for `null`. `?? 0` on a `Number()` result is banned in review. |
| R11 | **Rendering untrusted scraped text** — JD bodies and scout rows come from job boards. | Low but real | `react-markdown` with **no `rehype-raw`** (raw HTML stays inert by default — never add it); links render with `target="_blank" rel="noopener noreferrer"` and are never auto-opened or auto-fetched; no `dangerouslySetInnerHTML` anywhere in the client. |
| R12 | **The no-email constraint erodes** as the outbox gets more "helpful". | Low, high impact | Structural: the server has no mail dependency, no network egress code, and no route whose inputs could carry a draft body outward (`toggle` takes a path + boolean). No `mailto:` links. Add `npm run check:no-mail` — a grep for `smtp|nodemailer|sendmail|sendgrid|mailto:` across `server/src client/src shared` that exits non-zero on a hit — and run it in every phase's verification. |
| R13 | **dev-server slowness / bundle surprise** from `lucide-react`'s barrel or the markdown chunk. | Low | Named imports plus `optimizeDeps.include: ["lucide-react"]`; markdown surfaces behind `React.lazy`; check the production bundle once at Phase 6 with `rollup-plugin-visualizer` (a devDependency, added only if a check is actually needed). |
| R14 | **Feature creep into write territory** — "while we're here, let's edit notes / the profile". | Medium | §1.3 non-goals are the contract. Status is the only editable tracker field; the profile is read-only; CV imports remain `_pending-import-*`. Any new write needs its own plan revision. |

---

## 11. Open questions for the user (none blocking Phase 0–2)

1. **Follow-up threshold** — the "needs attention" nudge assumes 7 days idle
   after `contacted`. Configurable constant in `shared/jobhunt.ts`; confirm
   the number.
2. **Withdrawn/rejected on the board** — keep them as two visible right-hand
   columns (current plan), or collapse them behind an "Archive" toggle once
   they outnumber the active ones?
3. **"Queue this" from Scout** — current plan sends an anchored chat prompt
   asking the assistant to fetch and queue the posting. The alternative (a
   client-side form that pastes the JD text into `POST /api/apply/jd`) is
   more deterministic but requires the user to copy the text themselves.
   Preference?
