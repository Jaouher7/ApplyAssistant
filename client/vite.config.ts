import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// UI port from the dev harness via PORT (fallback 5300); API port mirrors
// server/src/index.ts: APPLY_ASSISTANT_PORT, else PORT+1 when
// harness-launched, else 4320. Same *kind* of derivation the Dashboard
// project (5173/3001) and AgentOS (5280/4200) both use — 5300/4320 were
// picked specifically so all can run concurrently on this machine without a
// port clash: job-hunt's own local web app already occupies 4300/5290
// (confirmed via `netstat -ano` + `Get-CimInstance Win32_Process` on the
// owning PIDs, not just assumed free).
const uiPort = Number(process.env.PORT ?? 5300);
const apiPort = Number(process.env.APPLY_ASSISTANT_PORT ?? (process.env.PORT ? uiPort + 1 : 4320));

export default defineConfig({
  plugins: [react()],
  server: {
    port: uiPort,
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      "/ws": { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
