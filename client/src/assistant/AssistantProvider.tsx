import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DriverEvent } from "../../../shared/apply";
import { sendApplyFrame, subscribeApply } from "./applyWs";
import { buildPipelinePrompt, buildScoutPrompt } from "./prompts";

/**
 * Chat session state lifted out of the old `ApplyChat` component so the
 * assistant is mounted once at the shell level and never unmounted by
 * navigation — a turn started from the Scout view keeps streaming while the
 * user reads the Pipeline. Behavior (WS protocol, single-flight, message
 * framing) is unchanged from the pre-overhaul component; only the "where
 * does this state live" changed.
 */

export type StreamBlock =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; result?: { preview: string; isError: boolean } };

export interface ChatMessage {
  role: "user" | "assistant";
  blocks: StreamBlock[];
}

interface AssistantContextValue {
  root: string;
  cliFound: boolean;
  configured: boolean;
  busy: boolean;
  error?: string;
  messages: ChatMessage[];
  streaming: StreamBlock[];
  jdPath?: string;
  setJdPath: (absPath: string) => void;
  submit: (text: string) => void;
  interrupt: () => void;
  runPipeline: () => void;
  runScout: () => void;
  clearError: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant() must be used inside <AssistantProvider>");
  return ctx;
}

interface AssistantProviderProps {
  root: string;
  cliFound: boolean;
  configured: boolean;
  /** Called once per completed turn — the data provider uses this as the
   *  cheap "refetch after a CLI turn ran" trigger. */
  onTurnComplete?: () => void;
  children: ReactNode;
}

export function AssistantProvider({ root, cliFound: initialCliFound, configured, onTurnComplete, children }: AssistantProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamBlock[]>([]);
  const [busy, setBusy] = useState(false);
  const [cliFound, setCliFound] = useState(initialCliFound);
  const [error, setError] = useState<string>();
  const [jdPath, setJdPath] = useState<string>();
  const onTurnCompleteRef = useRef(onTurnComplete);
  onTurnCompleteRef.current = onTurnComplete;

  useEffect(() => {
    return subscribeApply((frame) => {
      if (frame.type === "state") {
        setBusy(frame.busy);
        setCliFound(frame.cliFound);
        return;
      }
      if (frame.type === "error") {
        setError(frame.message);
        setBusy(false);
        return;
      }
      if (frame.type !== "driver") return;
      const e: DriverEvent = frame.event;
      switch (e.type) {
        case "assistant-text":
          setStreaming((prev) => [...prev, { kind: "text", text: e.text }]);
          break;
        case "tool-use":
          setStreaming((prev) => [...prev, { kind: "tool", id: e.id, name: e.name, input: e.input }]);
          break;
        case "tool-result":
          setStreaming((prev) =>
            prev.map((b) =>
              b.kind === "tool" && b.id === e.id
                ? { ...b, result: { preview: e.preview, isError: e.isError } }
                : b,
            ),
          );
          break;
        case "turn-complete":
          setBusy(false);
          setStreaming((prev) => {
            if (prev.length > 0) {
              setMessages((m) => [...m, { role: "assistant", blocks: prev }]);
            }
            return [];
          });
          onTurnCompleteRef.current?.();
          break;
        case "driver-error":
          setError(e.message);
          setBusy(false);
          break;
        case "session-init":
        default:
          break;
      }
    });
  }, []);

  const submit = (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    const ok = sendApplyFrame({ type: "send", text: t });
    if (!ok) {
      setError("Not connected to the Apply Assistant socket.");
      return;
    }
    setError(undefined);
    setBusy(true);
    setMessages((m) => [...m, { role: "user", blocks: [{ kind: "text", text: t }] }]);
  };

  const interrupt = () => sendApplyFrame({ type: "interrupt" });
  const runPipeline = () => {
    if (!jdPath) return;
    submit(buildPipelinePrompt(root, jdPath));
  };
  const runScout = () => submit(buildScoutPrompt(root));
  const clearError = () => setError(undefined);

  const value = useMemo<AssistantContextValue>(
    () => ({
      root,
      cliFound,
      configured,
      busy,
      error,
      messages,
      streaming,
      jdPath,
      setJdPath,
      submit,
      interrupt,
      runPipeline,
      runScout,
      clearError,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, cliFound, configured, busy, error, messages, streaming, jdPath],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
