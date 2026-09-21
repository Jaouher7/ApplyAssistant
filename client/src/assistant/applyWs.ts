import type { ApplyClientFrame, ApplyServerFrame } from "../../../shared/apply";

/**
 * WS subscribe/send helper for /ws/apply — adapted from AgentOS's
 * client/src/ws.ts (same connect/reconnect/pending-queue shape), pointed at
 * this project's own endpoint and frame types (shared/apply.ts). Unchanged
 * from the pre-overhaul `components/apply/applyWs.ts` — moved verbatim.
 */

type Listener = (frame: ApplyServerFrame) => void;

let socket: WebSocket | null = null;
const listeners = new Set<Listener>();
/** Frames sent while the socket is still connecting (or during the
 *  reconnect window) — flushed on open, so a send right after mount isn't
 *  silently dropped. */
let pending: string[] = [];

function connect(): void {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/ws/apply`);
  socket.onopen = () => {
    const queued = pending;
    pending = [];
    for (const raw of queued) socket?.send(raw);
  };
  socket.onmessage = (ev) => {
    try {
      const frame = JSON.parse(ev.data) as ApplyServerFrame;
      listeners.forEach((l) => l(frame));
    } catch {
      /* ignore malformed frames */
    }
  };
  socket.onclose = () => {
    socket = null;
    setTimeout(connect, 1500); // auto-reconnect
  };
}

export function subscribeApply(listener: Listener): () => void {
  if (!socket) connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sendApplyFrame(frame: ApplyClientFrame): boolean {
  const raw = JSON.stringify(frame);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(raw);
    return true;
  }
  if (socket?.readyState === WebSocket.CONNECTING) {
    pending.push(raw); // flushed by onopen
    return true;
  }
  return false;
}
