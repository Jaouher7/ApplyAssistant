/**
 * Loads ApplyAssistant/.env (repo root — NOT server/.env) before any other
 * module reads process.env. This must be the very first import in
 * index.ts: ES module imports are all resolved and evaluated, in order,
 * before any of the importing module's own top-level statements run — so a
 * bare `dotenv.config()` call written after `import { JOB_HUNT_ROOT } from
 * "./config"` in index.ts would run too late, since config.ts would already
 * have been evaluated (and JOB_HUNT_ROOT computed from an empty
 * process.env) as part of resolving that import. Putting the config() call
 * inside its own module and importing *that* first (`import "./loadEnv"`)
 * makes it run to completion before the next import is even loaded.
 *
 * Also: dotenv's own default `.config()` resolves the .env path relative to
 * `process.cwd()`, which is `server/` when this workspace's `dev`/`start`
 * script runs via `npm run dev -w server` — not the repo root where
 * `.env`/`.env.example` actually live. Compute the path from this file's
 * own location instead, so it's correct regardless of the invoking cwd.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
