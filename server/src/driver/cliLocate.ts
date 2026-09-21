import fs from "node:fs";
import path from "node:path";

/**
 * Locate the claude CLI executable. The npm package ships a native
 * `bin/claude.exe` on Windows — spawn that directly (no .cmd shim, no shell,
 * so arbitrary prompt text needs no quoting).
 *
 * Ported verbatim from AgentOS/server/src/driver/cliLocate.ts (via the
 * Dashboard project's prototype build of this feature) — no machine-specific
 * paths, only env-var derived candidate locations, so this is safe to commit
 * as-is.
 */
export function locateClaudeBin(): string | null {
  const candidates: string[] = [];
  if (process.env.APPDATA) {
    const pkg = path.join(
      process.env.APPDATA,
      "npm",
      "node_modules",
      "@anthropic-ai",
      "claude-code",
    );
    candidates.push(path.join(pkg, "bin", "claude.exe"));
  }
  if (process.env.LOCALAPPDATA) {
    // `claude install` native installer location
    candidates.push(
      path.join(process.env.LOCALAPPDATA, "Programs", "claude-code", "claude.exe"),
    );
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
