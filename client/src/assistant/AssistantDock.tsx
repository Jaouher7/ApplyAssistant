import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../lib/useReducedMotion";
import { cx } from "../lib/cx";
import { useAssistant, type StreamBlock } from "./AssistantProvider";
import { summarizeToolInput } from "./toolSummary";

/** One tool call rendered as the mockup's compact status line — a spinner
 *  while waiting for its result, a check once it resolves, error styling on
 *  failure. Raw input/result stay behind a disclosure triangle so nothing
 *  is hidden, just not shouted (no more raw `tool: X` / `tool result` JSON
 *  dumps inline). */
function ToolCallBlock({ block }: { block: Extract<StreamBlock, { kind: "tool" }> }) {
  const done = !!block.result;
  const isError = block.result?.isError ?? false;
  const summary = summarizeToolInput(block.name, block.input);
  return (
    <details className={cx("tool", isError && "err")}>
      <summary style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", listStyle: "none" }}>
        {done ? <span className={isError ? undefined : "tick"}>{isError ? "✗" : "✓"}</span> : <span className="sp" />}
        <span>
          {block.name}
          {summary ? ` · ${summary}` : ""}
        </span>
      </summary>
      <pre style={{ fontSize: 10.5, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "6px 0 0" }}>
        {JSON.stringify(block.input, null, 2)}
        {block.result ? `\n\n${block.result.preview}` : ""}
      </pre>
    </details>
  );
}

function MessageBlocks({ blocks }: { blocks: StreamBlock[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="txt" style={{ margin: 0 }}>
            {b.text}
          </p>
        ) : (
          <ToolCallBlock key={b.id} block={b} />
        ),
      )}
    </>
  );
}

export function AssistantDock() {
  const { messages, streaming, busy, cliFound, configured, error, jdPath, submit, interrupt, runPipeline, runScout, clearError } =
    useAssistant();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  }, [messages.length, streaming.length, reducedMotion]);

  const send = () => {
    submit(text);
    setText("");
  };

  const disabled = !configured;

  return (
    <aside className="dock" aria-label="Assistant">
      <div className="dock-h">
        <span style={{ color: "var(--accent)" }}>◈</span> Assistant
      </div>

      {!cliFound && (
        <div className="dock-banner">
          claude CLI not found — install @anthropic-ai/claude-code and log in once (claude → /login), then restart
          the server.
        </div>
      )}

      <div className="dock-b">
        {messages.length === 0 && streaming.length === 0 && (
          <div className="msg" style={{ color: "var(--faint)" }}>
            Ask the assistant to run the pipeline on a routed posting, scout for new offers, or anything else the
            job-hunt automation can do.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cx("msg", m.role === "user" && "you")}>
            <div className="who">{m.role === "user" ? "You" : "Assistant"}</div>
            {m.role === "user" ? (
              <div className="bub">
                <MessageBlocks blocks={m.blocks} />
              </div>
            ) : (
              <MessageBlocks blocks={m.blocks} />
            )}
          </div>
        ))}
        {streaming.length > 0 && (
          <div className="msg">
            <div className="who">Assistant…</div>
            <MessageBlocks blocks={streaming} />
          </div>
        )}
        {busy && streaming.length === 0 && (
          <div className="msg" style={{ color: "var(--faint)", fontStyle: "italic" }}>
            thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="dock-error" onClick={clearError} role="button" tabIndex={0}>
          {error} (dismiss)
        </div>
      )}

      <div className="dock-f">
        <div className="qa">
          <button
            disabled={disabled || busy || !jdPath}
            onClick={runPipeline}
            title={!jdPath ? "Route a job posting first (Intake)" : undefined}
          >
            Run pipeline
          </button>
          <button disabled={disabled || busy} onClick={runScout}>
            Scout
          </button>
        </div>
        <div className="composer">
          <input
            placeholder="Ask anything…"
            aria-label="Message"
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (busy) return;
                send();
              }
            }}
          />
          {busy ? (
            <button className="kbd" onClick={interrupt} aria-label="Stop">
              ■
            </button>
          ) : (
            <span className="kbd">↵</span>
          )}
        </div>
      </div>
    </aside>
  );
}
