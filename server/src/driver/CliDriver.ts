import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import readline from "node:readline";
import type { DriverEvent } from "../../../shared/apply";

/**
 * Ported from AgentOS server/src/driver/CliDriver.ts (via the Dashboard
 * project's prototype build of this feature), trimmed for this app's
 * narrower use case:
 *  - No screenshot/snapshot support — `send()` takes a plain prompt string.
 *  - No `AppConfig`/settings service — `model`/`allowedTools` are hardcoded
 *    constants below (same values AgentOS's own `DEFAULT_CONFIG` ships,
 *    already proven to drive the workflow-runner/job-scout skills) instead
 *    of read from a user-editable config file this app doesn't have.
 *  - Session resume is tracked internally (a private field, not exposed via
 *    `getResumeId`/`onSessionId` callbacks) so one server-lifetime
 *    conversation stays coherent turn-to-turn without an on-disk
 *    session-persistence service.
 *  - `DriverEvent`'s `turn-complete` has no `usage` field here (trimmed in
 *    shared/apply.ts's narrower copy of the type) — dropped from the emitted
 *    object below to match.
 *
 * One turn = one `claude -p` spawn with `--output-format stream-json`.
 * Interrupt = kill the child (turn aborted; the CLI's own session file
 * survives on disk, so `--resume` still works for the next turn).
 */

// Skill + Agent so the turn can invoke the workflow-runner / job-scout
// skills and their subagents (researcher/writer/dev/qa carry their own tool
// permissions, independent of this top-level turn's --allowedTools);
// Read/Glob/Grep for inspection; WebSearch/WebFetch for the researcher step;
// TodoWrite for progress tracking.
//
// Write/Edit are REQUIRED at this top level and must not be removed: the
// `job-scout` skill does its own file writes rather than delegating them
// (its SKILL.md spells out why — it needs WebSearch *and* Write in one
// agent, which no single specialist agent has). Without Write, a scout
// sweep researches correctly and then dies with a permission error trying
// to save `scout\shortlist-<date>.md`, and the model falls back to a `cp`
// that is also denied. That was a real, user-visible failure.
//
// Do NOT read this list as a security boundary. Measured behaviour of the
// CLI as of 2026-07-29: omitting a tool here does not reliably block it —
// `Bash` is absent from this list and still executes (verified with an
// `echo` probe through this exact driver). Yet adding `Write` demonstrably
// fixed a hard permission failure. So treat this as "grant what the turn
// needs" and assume the turn may reach other tools anyway.
//
// The containment that IS enforced is the CLI session's working directory,
// always JOB_HUNT_ROOT (see CliDriverOpts.cwd). Operations reaching outside
// it are refused with an explicit "may only ... the allowed working
// directories for this session" error. That, not this array, is why a turn
// driven from this web UI cannot touch anything outside the job-hunt
// project. If you need a real tool-level restriction, enforce it with a
// permission mode / settings policy and verify it empirically.
const MODEL = "sonnet";
const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Write",
  "Edit",
  "WebSearch",
  "WebFetch",
  "Agent",
  "Skill",
  "TodoWrite",
];

export interface CliDriverOpts {
  cliBin: string;
  /** Spawn cwd — always JOB_HUNT_ROOT (see config.ts). The caller must only
   *  invoke send() once JOB_HUNT_ROOT is confirmed to be a real directory. */
  cwd: string;
  onEvent: (e: DriverEvent) => void;
}

export class CliDriver {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private interrupted = false;
  private sawResult = false;
  private resumeId: string | undefined;

  constructor(private opts: CliDriverOpts) {}

  get busy(): boolean {
    return this.child !== null;
  }

  async send(text: string): Promise<void> {
    if (this.child) throw new Error("A turn is already running");

    const args = [
      "-p",
      text,
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      MODEL,
      "--allowedTools",
      ALLOWED_TOOLS.join(","),
    ];
    if (this.resumeId) args.push("--resume", this.resumeId);

    this.interrupted = false;
    this.sawResult = false;
    const child = spawn(this.opts.cliBin, args, {
      cwd: this.opts.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    let stderrTail = "";
    child.stderr.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        this.handleMessage(JSON.parse(trimmed));
      } catch {
        // Unknown/partial line — log, never fatal.
        console.warn("[CliDriver] unparseable line:", trimmed.slice(0, 200));
      }
    });

    await new Promise<void>((resolve) => {
      // Settle exactly once whether the child closes normally OR fails to
      // spawn at all ("error" without "close" — e.g. binary moved/deleted).
      // Without the error handler this promise never resolves, this.child
      // stays set, and every future send is rejected as "already running".
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.child = null;
        fn();
        resolve();
      };

      child.on("error", (err) => {
        settle(() => {
          this.opts.onEvent({
            type: "driver-error",
            message: `failed to start claude: ${String((err as Error)?.message ?? err)}`,
          });
          this.opts.onEvent({ type: "turn-complete", subtype: "crashed", isError: true });
        });
      });

      child.on("close", (code) => {
        settle(() => {
          if (this.sawResult) return;
          // Killed or crashed before the result event.
          if (this.interrupted) {
            this.opts.onEvent({
              type: "turn-complete",
              subtype: "interrupted",
              isError: false,
            });
          } else {
            this.opts.onEvent({
              type: "driver-error",
              message: `claude exited with code ${code}: ${stderrTail.trim() || "(no stderr)"}`,
            });
            this.opts.onEvent({
              type: "turn-complete",
              subtype: "crashed",
              isError: true,
            });
          }
        });
      });
    });
  }

  // stream-json line → DriverEvent(s)
  private handleMessage(msg: any): void {
    const emit = this.opts.onEvent;
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init" && msg.session_id) {
          this.resumeId = msg.session_id;
          emit({
            type: "session-init",
            sessionId: msg.session_id,
            model: msg.model ?? "unknown",
          });
        }
        break;
      case "assistant": {
        const blocks = msg.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "text" && block.text) {
            emit({ type: "assistant-text", text: block.text });
          } else if (block.type === "tool_use") {
            emit({
              type: "tool-use",
              id: block.id,
              name: block.name,
              input: block.input,
              parentId: msg.parent_tool_use_id ?? undefined,
            });
          }
        }
        break;
      }
      case "user": {
        const blocks = msg.message?.content;
        if (!Array.isArray(blocks)) break;
        for (const block of blocks) {
          if (block.type === "tool_result") {
            const raw =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? "");
            emit({
              type: "tool-result",
              id: block.tool_use_id,
              preview: raw.slice(0, 400),
              isError: block.is_error === true,
            });
          }
        }
        break;
      }
      case "result":
        this.sawResult = true;
        emit({
          type: "turn-complete",
          subtype: msg.subtype ?? "unknown",
          costUsd: msg.total_cost_usd,
          isError: msg.is_error === true || msg.subtype !== "success",
        });
        break;
      default:
        break; // stream_event and others: ignored in v1
    }
  }

  async interrupt(): Promise<void> {
    if (!this.child) return;
    this.interrupted = true;
    this.child.kill();
  }
}
