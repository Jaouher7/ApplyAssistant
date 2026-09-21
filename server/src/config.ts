import fs from "node:fs";
import path from "node:path";

/**
 * Absolute path to your job-hunt project, from env only — no hardcoded
 * machine-specific path lives here, since this repo may end up public
 * (same stance the Dashboard project this feature was originally
 * prototyped in took). Empty string when JOB_HUNT_ROOT is unset; callers
 * must treat "" as "not configured" and never resolve it as a real path.
 *
 * Relies on `./loadEnv` having already populated process.env — index.ts
 * imports "./loadEnv" before anything that (transitively) imports this
 * module.
 */
export const JOB_HUNT_ROOT = process.env.JOB_HUNT_ROOT ?? "";

/** True only when JOB_HUNT_ROOT is set AND currently points at a real
 *  directory on disk. Never throws. */
export function isJobHuntConfigured(): boolean {
  if (!JOB_HUNT_ROOT) return false;
  try {
    return fs.statSync(JOB_HUNT_ROOT).isDirectory();
  } catch {
    return false;
  }
}

export { locateClaudeBin } from "./driver/cliLocate";

/**
 * Resolve relPath against JOB_HUNT_ROOT, jailed to it (path.resolve +
 * startsWith(root + sep) guard). Throws if JOB_HUNT_ROOT isn't configured,
 * or if the resolved path escapes root (e.g. a ".." segment that got past
 * upstream validation) — so any caller can never read/write outside
 * JOB_HUNT_ROOT.
 */
export function jailed(relPath: string): string {
  if (!JOB_HUNT_ROOT) {
    throw new Error("JOB_HUNT_ROOT is not configured");
  }
  const root = path.resolve(JOB_HUNT_ROOT);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Path escapes job-hunt root");
  }
  return abs;
}
