# Apply Assistant

A local-only mission-control dashboard over your own
`job-hunt` project: an Overview with KPIs/funnel/needs-attention,
a drag-and-drop (and keyboard-accessible) Pipeline board, a Scout view of the
latest ranked shortlist, an application detail drawer with an inline PDF
preview, a PDF intake surface, and an assistant dock that drives that
project's `job-application-pipeline` workflow and `job-scout` skill via the
local `claude` CLI, streamed live over WebSocket.

This app does **nothing** on its own: it is a second front-end onto
automation that already lives in your `job-hunt\` folder (the
`workflow-runner` skill's `job-application-pipeline` workflow and the
`job-scout` skill). It never invents new pipeline logic — it just drives what
already exists, from a PDF-drop-and-chat UI instead of a CLI prompt.

## What it does

- **PDF intake.** Drop a PDF and the server extracts its text in memory and
  classifies it as a *job posting* or a *CV* with a confidence score. You
  confirm or override the classification, then it's routed:
  - a **job posting** is written into `job-hunt\jobs\incoming\<slug>.md` in
    the same frontmatter shape the pipeline expects;
  - a **CV** is written to a clearly-marked
    `job-hunt\profile\_pending-import-<date>.md` review file that nothing
    ever auto-merges — you merge it by hand. `master-profile.*.md` is never
    touched by this app.
- **Overview / Pipeline / Scout / detail drawer.** Read-only (plus one
  guarded write — dragging a card or using its status `<select>` patches
  `tracker.csv`'s `status` column, nothing else) views over `tracker.csv`,
  `outbox\manifest.md`, `applications\*\`, and `scout\latest.md`. The KPI
  tiles, pipeline funnel, and "needs attention" nudges are all derived
  client-side from that data — nothing is invented or cached server-side.
- **Assistant dock.** A chat panel that spawns the local `claude` CLI in
  headless mode and streams its output live over a WebSocket. Typing
  something like "run the pipeline on the Acme Corp posting" or "scout for
  new offers" drives the `job-application-pipeline` workflow / `job-scout`
  skill against your `job-hunt\` folder, with every relative path explicitly
  anchored to it.

## Prerequisites

1. The [`claude` CLI](https://docs.claude.com/en/docs/claude-code) installed
   and logged in (`claude` → `/login`).
2. Your **own** local `job-hunt\` project folder (the automated
   job-application pipeline this app drives — not included here).

Without both of these, the app shows a "not configured" state and does
nothing else.

## Setup

```sh
npm install
cp .env.example .env
# edit .env and set JOB_HUNT_ROOT=C:\path\to\your\job-hunt
npm run dev
```

Open the URL Vite prints (default `http://localhost:5300`).

The server and client ports (5300/4320 by default) were chosen specifically
to not clash with the Agent Traffic Dashboard project (5173/3001), AgentOS
(5280/4200), or job-hunt's own local web app (5290/4300) if you happen to run
this alongside them — see the comments in `server/src/index.ts` and
`client/vite.config.ts` for the exact derivation logic and override env vars
(`APPLY_ASSISTANT_PORT`, `PORT`).

## Privacy

Uploaded PDFs are processed **entirely in memory** and are **never** written
anywhere inside this repository. Extracted text is written only under your
own `JOB_HUNT_ROOT` folder, outside this repo. No CV content, job posting, or
application data ever touches this project's own `server/`, `client/`, or
`shared/` directories. There is no email-sending capability anywhere in this
app.

## Layout

| Path | What it is |
|---|---|
| `shared/apply.ts` | Types shared by server routes and client panel |
| `server/src/index.ts` | Fastify server: `/api/apply/*` routes, `/ws/apply` CLI chat driver |
| `server/src/config.ts` | `JOB_HUNT_ROOT`, `jailed()` path guard, CLI locate re-export |
| `server/src/driver/` | `CliDriver` (spawns `claude -p ... --output-format stream-json`), `cliLocate` |
| `server/src/services/` | `pdf.ts` (text extraction), `classify.ts` (job posting vs CV heuristic), `jobHuntWrite.ts` (jailed writes into job-hunt) |
| `client/` | React + Vite, no deps beyond `react`/`react-dom`: rail-navigated views (Overview/Pipeline/Scout/Intake), a detail drawer, and an always-mounted assistant dock |

## API

- `GET /api/apply/status` — `{ jobHuntConfigured, root, cliFound }`
- `POST /api/apply/upload` — multipart PDF upload → extracted text + classification
- `POST /api/apply/jd` — write a confirmed job posting into `job-hunt\jobs\incoming\`
- `POST /api/apply/cv-import` — write a confirmed CV into `job-hunt\profile\_pending-import-*.md`
- `GET /api/apply/tracker` / `PATCH /api/apply/tracker/status` — read `tracker.csv`; the only allowed write is the `status` column
- `GET /api/apply/outbox` / `PATCH /api/apply/outbox/toggle` — read/toggle-reviewed on `outbox\manifest.md`
- `GET /api/apply/applications` / `GET /api/apply/applications/:folder` — folder list / full detail (files, contacts, keywords, ATS lint, drafts, JD)
- `GET /api/apply/scout` — parsed `scout\latest.md`
- `GET /api/apply/profile?file=` — whitelisted `master-profile.<lang>.md` read
- `GET /api/apply/file?path=` — jailed, extension-allowlisted text file read
- `GET /api/apply/pdf?path=` — jailed `.pdf` byte stream, for the drawer's inline preview `<iframe>`
- `POST /api/apply/open` — open a `.docx`/`.pdf` in the OS default app
- `WS /ws/apply` — CLI chat driver (`{type:"send",text}` / `{type:"interrupt"}` in, `state`/`driver`/`error` frames out)

## Hard constraints

- No hardcoded absolute machine path anywhere — `JOB_HUNT_ROOT` from env
  only, `.env` gitignored, `.env.example` committed.
- PDFs processed in memory only, never written to this project's own disk.
- The CV-import route only ever writes
  `job-hunt\profile\_pending-import-<date>.md`, never touches
  `master-profile.*.md`.
- Every job-hunt file write is jailed to `JOB_HUNT_ROOT` (`jailed()` in
  `server/src/config.ts`).
- No email-sending capability anywhere.
