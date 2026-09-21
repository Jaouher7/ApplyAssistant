import "./loadEnv"; // must be the very first import — see loadEnv.ts's doc comment
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fs from "node:fs";
import path from "node:path";
import type { WebSocket } from "ws";
import type {
  ApplyClientFrame,
  ApplyServerFrame,
  ApplyStatus,
  ApplicationsListResponse,
  DriverEvent,
  FileReadResponse,
  OutboxResponse,
  ProfileReadResponse,
  ScoutResponse,
  TrackerResponse,
  UploadResult,
} from "../../shared/apply";
import { JOB_HUNT_ROOT, isJobHuntConfigured, locateClaudeBin } from "./config";
import { extractPdfText } from "./services/pdf";
import { classify } from "./services/classify";
import {
  writeIncomingJD,
  writeCvPendingImport,
  JdInvalidInputError,
  JdSlugCollisionError,
  CvImportInvalidInputError,
} from "./services/jobHuntWrite";
import {
  readTracker,
  updateTrackerStatus,
  TrackerRowNotFoundError,
  InvalidTrackerStatusError,
  readOutbox,
  toggleOutboxItem,
  OutboxItemNotFoundError,
  listApplicationFolders,
  getApplicationDetail,
  ApplicationFolderNotFoundError,
  readScoutLatest,
  readProfileFile,
  ProfileFileNotAllowedError,
  readTextFile,
  resolvePdfPath,
  FileNotAllowedError,
  FileNotFoundError,
  openFile,
  OpenFileInvalidError,
  OpenFileNotFoundError,
} from "./services/jobHuntRead";
import { CliDriver } from "./driver/CliDriver";

// APPLY_ASSISTANT_PORT wins; else derive from the harness-assigned frontend
// PORT (PORT itself belongs to Vite — never bind it here); else 4320. Same
// *kind* of derivation the Dashboard project's server/src/index.ts and
// AgentOS's server/src/config.ts both use (DASHBOARD_PORT/PORT+1/3001 and
// AGENTOS_API_PORT/PORT+1/4200 respectively) — 4320 was picked as the
// default here specifically because it's free alongside those two apps'
// defaults (3001 and 4200) *and* job-hunt's own local web app, which (at
// the time this was written) already occupies 4300/5290 on this machine —
// checked via `netstat -ano` + `Get-CimInstance Win32_Process` on the
// owning PIDs before picking a number, not just assumed free.
const PORT = Number(
  process.env.APPLY_ASSISTANT_PORT ?? (process.env.PORT ? Number(process.env.PORT) + 1 : 4320),
);
const HOST = process.env.APPLY_ASSISTANT_HOST ?? "127.0.0.1";

const app = Fastify({ logger: false });
await app.register(websocket);
// 20MB is generous headroom over a typical CV/JD PDF; the buffer this
// yields is processed entirely in memory and never written to this
// project's own disk.
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

app.get("/health", async () => ({ ok: true }));

// --- Apply Assistant routes ----------------------------------------------
// Never crashes on bad input; gracefully degrades to jobHuntConfigured:false
// when JOB_HUNT_ROOT is unset or invalid — a fresh clone with no .env still
// boots and serves /health as today, just with every /api/apply/* route
// reporting "not configured".

/** Never throws: a missing/invalid JOB_HUNT_ROOT or missing CLI yields
 *  jobHuntConfigured:false / cliFound:false, not an error. */
app.get("/api/apply/status", async () => {
  const root = JOB_HUNT_ROOT ? path.resolve(JOB_HUNT_ROOT) : "";
  const status: ApplyStatus = {
    jobHuntConfigured: isJobHuntConfigured(),
    root,
    cliFound: locateClaudeBin() !== null,
  };
  return status;
});

/** multipart/form-data, field "file", PDF only. The upload buffer is read
 *  via request.file()/toBuffer(), extracted, and discarded — never written
 *  to this project's own disk. Extraction + classification only; no
 *  job-hunt write happens here (that's /api/apply/jd and
 *  /api/apply/cv-import). */
app.post("/api/apply/upload", async (request, reply) => {
  let file: Awaited<ReturnType<typeof request.file>>;
  try {
    file = await request.file();
  } catch {
    reply.code(400);
    return { error: 'Expected multipart/form-data with a "file" field.' };
  }
  if (!file) {
    reply.code(400);
    return { error: 'No file uploaded (expected multipart field "file").' };
  }

  const looksLikePdf =
    file.mimetype === "application/pdf" || /\.pdf$/i.test(file.filename ?? "");
  if (!looksLikePdf) {
    reply.code(400);
    return { error: "Only PDF files are accepted." };
  }

  const buffer = await file.toBuffer(); // in-memory only — never fs.writeFileSync'd
  let text: string;
  try {
    text = await extractPdfText(buffer);
  } catch (err) {
    reply.code(400);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Couldn't read a text layer from this PDF — it may be scanned/image-only.",
    };
  }

  const result = classify(text);
  const response: UploadResult = {
    filename: file.filename,
    textLength: text.length,
    classification: result.classification,
    confidence: result.confidence,
    signals: result.signals,
    text,
    suggested: result.suggested,
  };
  return response;
});

/** Adapts writeIncomingJD → JOB_HUNT_ROOT\jobs\incoming\<slug>.md. */
app.post("/api/apply/jd", async (request, reply) => {
  if (!isJobHuntConfigured()) {
    reply.code(503);
    return { error: "not configured" };
  }
  const body = (request.body ?? {}) as Partial<{
    company: string;
    roleTitle: string;
    sourceUrl: string;
    text: string;
  }>;
  try {
    const result = writeIncomingJD({
      company: body.company ?? "",
      roleTitle: body.roleTitle ?? "",
      sourceUrl: body.sourceUrl ?? "",
      text: body.text ?? "",
    });
    reply.code(201);
    return result;
  } catch (err) {
    if (err instanceof JdSlugCollisionError) {
      reply.code(409);
      return { error: err.message };
    }
    if (err instanceof JdInvalidInputError) {
      reply.code(400);
      return { error: err.message };
    }
    reply.code(400);
    return { error: err instanceof Error ? err.message : "Invalid request" };
  }
});

/** The CV-safety call: writes ONLY JOB_HUNT_ROOT\profile\_pending-import-
 *  <date>.md (server-generated filename, no client-supplied path anywhere
 *  in this route) — never master-profile.*.md / achievement-bank.*.md /
 *  skills-inventory.yaml. */
app.post("/api/apply/cv-import", async (request, reply) => {
  if (!isJobHuntConfigured()) {
    reply.code(503);
    return { error: "not configured" };
  }
  const body = (request.body ?? {}) as Partial<{ text: string }>;
  try {
    const result = writeCvPendingImport({ text: body.text ?? "" });
    reply.code(201);
    return result;
  } catch (err) {
    if (err instanceof CvImportInvalidInputError) {
      reply.code(400);
      return { error: err.message };
    }
    reply.code(400);
    return { error: err instanceof Error ? err.message : "Invalid request" };
  }
});

// --- Apply Assistant data-layer routes (tracker/outbox/applications/scout/
// profile/file/pdf/open) --------------------------------------------------
// Every route below is jailed to JOB_HUNT_ROOT (server/src/services/
// jobHuntRead.ts) and degrades to an empty/configured:false shape rather
// than throwing when JOB_HUNT_ROOT is unset.

app.get("/api/apply/tracker", async () => {
  const response: TrackerResponse = {
    configured: isJobHuntConfigured(),
    rows: readTracker(),
  };
  return response;
});

app.patch("/api/apply/tracker/status", async (request, reply) => {
  if (!isJobHuntConfigured()) {
    reply.code(503);
    return { error: "not configured" };
  }
  const body = (request.body ?? {}) as Partial<{ applicationFolder: string; status: string }>;
  const applicationFolder = (body.applicationFolder ?? "").trim();
  const status = (body.status ?? "").trim();
  if (!applicationFolder || !status) {
    reply.code(400);
    return { error: "applicationFolder and status are required" };
  }
  try {
    return updateTrackerStatus(applicationFolder, status);
  } catch (err) {
    if (err instanceof InvalidTrackerStatusError) {
      reply.code(400);
      return { error: err.message };
    }
    if (err instanceof TrackerRowNotFoundError) {
      reply.code(404);
      return { error: err.message };
    }
    reply.code(400);
    return { error: err instanceof Error ? err.message : "Invalid request" };
  }
});

app.get("/api/apply/outbox", async () => {
  const response: OutboxResponse = {
    configured: isJobHuntConfigured(),
    items: readOutbox(),
  };
  return response;
});

app.patch("/api/apply/outbox/toggle", async (request, reply) => {
  if (!isJobHuntConfigured()) {
    reply.code(503);
    return { error: "not configured" };
  }
  const body = (request.body ?? {}) as Partial<{ draftPath: string; reviewed: boolean }>;
  const draftPath = (body.draftPath ?? "").trim();
  if (!draftPath || typeof body.reviewed !== "boolean") {
    reply.code(400);
    return { error: "draftPath (string) and reviewed (boolean) are required" };
  }
  try {
    const items = toggleOutboxItem(draftPath, body.reviewed);
    const response: OutboxResponse = { configured: true, items };
    return response;
  } catch (err) {
    if (err instanceof OutboxItemNotFoundError) {
      reply.code(404);
      return { error: err.message };
    }
    reply.code(400);
    return { error: err instanceof Error ? err.message : "Invalid request" };
  }
});

app.get("/api/apply/applications", async () => {
  const response: ApplicationsListResponse = {
    configured: isJobHuntConfigured(),
    folders: listApplicationFolders(),
  };
  return response;
});

app.get<{ Params: { folder: string } }>(
  "/api/apply/applications/:folder",
  async (request, reply) => {
    if (!isJobHuntConfigured()) {
      reply.code(503);
      return { error: "not configured" };
    }
    try {
      return getApplicationDetail(request.params.folder);
    } catch (err) {
      if (err instanceof ApplicationFolderNotFoundError) {
        reply.code(404);
        return { error: err.message };
      }
      reply.code(400);
      return { error: err instanceof Error ? err.message : "Invalid request" };
    }
  },
);

app.get("/api/apply/scout", async () => {
  const response: ScoutResponse = readScoutLatest();
  return response;
});

app.get<{ Querystring: { file?: string } }>("/api/apply/profile", async (request, reply) => {
  if (!isJobHuntConfigured()) {
    reply.code(503);
    return { error: "not configured" };
  }
  try {
    const content = readProfileFile(request.query.file ?? "");
    const response: ProfileReadResponse = { content };
    return response;
  } catch (err) {
    if (err instanceof ProfileFileNotAllowedError) {
      reply.code(400);
      return { error: err.message };
    }
    reply.code(404);
    return { error: err instanceof Error ? err.message : "Not found" };
  }
});

app.get<{ Querystring: { path?: string } }>("/api/apply/file", async (request, reply) => {
  if (!isJobHuntConfigured()) {
    reply.code(503);
    return { error: "not configured" };
  }
  const relPath = request.query.path ?? "";
  if (!relPath) {
    reply.code(400);
    return { error: "path is required" };
  }
  try {
    const content = readTextFile(relPath);
    const response: FileReadResponse = { path: relPath, content };
    return response;
  } catch (err) {
    if (err instanceof FileNotAllowedError) {
      reply.code(400);
      return { error: err.message };
    }
    if (err instanceof FileNotFoundError) {
      reply.code(404);
      return { error: err.message };
    }
    reply.code(400);
    return { error: err instanceof Error ? err.message : "Invalid request" };
  }
});

app.get<{ Querystring: { path?: string } }>("/api/apply/pdf", async (request, reply) => {
  if (!isJobHuntConfigured()) {
    reply.code(503);
    return { error: "not configured" };
  }
  const relPath = request.query.path ?? "";
  if (!relPath) {
    reply.code(400);
    return { error: "path is required" };
  }
  try {
    const abs = resolvePdfPath(relPath);
    reply.header("Content-Disposition", "inline");
    reply.type("application/pdf");
    return reply.send(fs.createReadStream(abs));
  } catch (err) {
    if (err instanceof FileNotAllowedError) {
      reply.code(400);
      return { error: err.message };
    }
    if (err instanceof FileNotFoundError) {
      reply.code(404);
      return { error: err.message };
    }
    reply.code(400);
    return { error: err instanceof Error ? err.message : "Invalid request" };
  }
});

app.post("/api/apply/open", async (request, reply) => {
  if (!isJobHuntConfigured()) {
    reply.code(503);
    return { error: "not configured" };
  }
  const body = (request.body ?? {}) as Partial<{ path: string }>;
  const relPath = (body.path ?? "").trim();
  if (!relPath) {
    reply.code(400);
    return { error: "path is required" };
  }
  try {
    openFile(relPath);
    return { ok: true };
  } catch (err) {
    if (err instanceof OpenFileInvalidError) {
      reply.code(400);
      return { error: err.message };
    }
    if (err instanceof OpenFileNotFoundError) {
      reply.code(404);
      return { error: err.message };
    }
    reply.code(400);
    return { error: err instanceof Error ? err.message : "Invalid request" };
  }
});

// --- Apply Assistant CLI chat driver (WS /ws/apply) -----------------------
// One shared CliDriver instance enforces the single-flight guard across
// every connected client — this is a single local-user app; if more than
// one browser tab is open, only one turn may run at a time (same semantics
// AgentOS's chat driver uses). `applyCliBin` is resolved once at startup,
// same as JOB_HUNT_ROOT above: both are fixed for the server's lifetime, so
// a `.env`/CLI-install change requires a restart to take effect.
const applyCliBin = locateClaudeBin();
const applySockets = new Set<WebSocket>();

/** Driver events (assistant text, tool use, turn-complete, ...) are relayed
 *  to every connected /ws/apply client — there is only ever one turn
 *  in-flight at a time (single-flight guard below), so every tab watches
 *  the same shared turn. Per-request protocol errors (bad frame, CLI
 *  missing, not configured, already running) are instead replied only to
 *  the socket that sent the frame that caused them. */
function broadcastApply(frame: ApplyServerFrame): void {
  const json = JSON.stringify(frame);
  for (const ws of applySockets) {
    if (ws.readyState === 1 /* OPEN */) ws.send(json);
  }
}

function safeSendApply(ws: WebSocket, frame: ApplyServerFrame): void {
  if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(frame));
}

function onApplyDriverEvent(event: DriverEvent): void {
  broadcastApply({ type: "driver", event });
}

// Only constructed when the CLI was actually found. `cwd: JOB_HUNT_ROOT` is
// safe even when JOB_HUNT_ROOT is "" (unconfigured) because every `send`
// call below is gated on isJobHuntConfigured() first — the driver never
// actually spawns against an empty/invalid cwd.
const cliDriver = applyCliBin
  ? new CliDriver({ cliBin: applyCliBin, cwd: JOB_HUNT_ROOT, onEvent: onApplyDriverEvent })
  : null;

app.get("/ws/apply", { websocket: true }, (conn) => {
  // @fastify/websocket v11 passes the WebSocket directly; v10 wraps it in { socket }
  const ws: WebSocket = (conn as unknown as { socket?: WebSocket }).socket ?? (conn as unknown as WebSocket);
  applySockets.add(ws);

  // On connect: resync state so a client that (re)loads mid-turn knows the
  // driver is busy, and knows up front whether it's even usable.
  safeSendApply(ws, {
    type: "state",
    busy: cliDriver?.busy ?? false,
    cliFound: applyCliBin !== null,
    configured: isJobHuntConfigured(),
  });

  ws.on("close", () => applySockets.delete(ws));

  // Hard constraint: this endpoint must never crash the server. Every
  // failure mode below (malformed frame, CLI not found, not configured,
  // turn already running, spawn failure) yields a clean `error` frame back
  // to the socket that triggered it, never an unhandled exception.
  ws.on("message", (raw: Buffer) => {
    try {
      let frame: ApplyClientFrame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        safeSendApply(ws, { type: "error", message: "Malformed message — expected JSON." });
        return;
      }
      if (!frame || typeof frame !== "object" || typeof (frame as { type?: unknown }).type !== "string") {
        safeSendApply(ws, { type: "error", message: "Malformed message — missing frame type." });
        return;
      }

      if (frame.type === "send") {
        if (typeof frame.text !== "string" || !frame.text.trim()) {
          safeSendApply(ws, { type: "error", message: "Malformed 'send' frame — missing text." });
          return;
        }
        if (!applyCliBin || !cliDriver) {
          safeSendApply(ws, {
            type: "error",
            message:
              "claude CLI not found — install @anthropic-ai/claude-code and log in once (claude → /login), then restart the server.",
          });
          return;
        }
        if (!isJobHuntConfigured()) {
          safeSendApply(ws, {
            type: "error",
            message: "Apply Assistant is not configured — set JOB_HUNT_ROOT in .env (see .env.example).",
          });
          return;
        }
        if (cliDriver.busy) {
          safeSendApply(ws, { type: "error", message: "A turn is already running — interrupt it first." });
          return;
        }
        cliDriver.send(frame.text).catch((err) => {
          safeSendApply(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
        });
      } else if (frame.type === "interrupt") {
        void cliDriver?.interrupt();
      } else {
        safeSendApply(ws, {
          type: "error",
          message: `Unknown frame type: ${String((frame as { type?: unknown }).type)}`,
        });
      }
    } catch (err) {
      // Belt-and-suspenders: no path above should throw synchronously, but
      // this socket must survive even if one does.
      safeSendApply(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });
});

await app.listen({ port: PORT, host: HOST });
console.log(`Apply Assistant server listening on http://${HOST}:${PORT}`);
console.log(`  GET  http://${HOST}:${PORT}/health`);
console.log(`  GET  http://${HOST}:${PORT}/api/apply/status`);
console.log(
  `  WS   ws://${HOST}:${PORT}/ws/apply       — CLI chat (cli: ${applyCliBin ?? "NOT FOUND"})`,
);
