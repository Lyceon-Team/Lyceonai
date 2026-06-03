#!/usr/bin/env node
// Stop hook — verification loop. STATUS: NOT WIRED pre-launch (rely on /grill-me
// + in-prompt verification + spec-auditor). Retained as the hardening artifact:
// at hardening, add a "Stop" entry in settings.json pointing here and set
// LYCEON_STOP_GATE=block.
//   warn (default)  -> systemMessage to the user, lets the turn end (exit 0)
//   block           -> exit(2), stderr fed to Claude, turn continues until green
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
const gate = process.env.LYCEON_STOP_GATE || "warn";
if (!existsSync("package.json")) process.exit(0);
let out = "", ok = true;
try { out = execSync("pnpm -s run build && pnpm test", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
catch (e) { ok = false; out = `${e.stdout || ""}\n${e.stderr || ""}`; }
if (ok) process.exit(0);
const tail = out.trim().split("\n").slice(-30).join("\n");
if (gate === "block") {
  process.stderr.write("STOP-GATE (block): build or tests failing. Fix the root cause before ending the turn.\n----- output (tail) -----\n" + tail + "\n");
  process.exit(2);
}
process.stdout.write(JSON.stringify({
  systemMessage: "STOP-GATE (warn, pre-launch): build or tests are NOT green. Set LYCEON_STOP_GATE=block at hardening.\n----- output (tail) -----\n" + tail,
  suppressOutput: true,
}));
process.exit(0);
