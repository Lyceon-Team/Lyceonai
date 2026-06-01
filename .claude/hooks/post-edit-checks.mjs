#!/usr/bin/env node
// PostToolUse (matcher: Write|Edit). WARN-ONLY (pre-launch). Never blocks.
// Emits findings as hookSpecificOutput.additionalContext so CLAUDE sees them.
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let j = {};
  try { j = JSON.parse(raw); } catch {}
  const ti = j.tool_input || {};
  const file = ti.file_path || ti.path || "";
  if (!file || !/\.(ts|tsx)$/.test(file)) process.exit(0);
  const skipAnnot = /\.(d\.ts|test\.ts|test\.tsx|spec\.ts)$/.test(file);

  const warns = [];
  if (!skipAnnot && existsSync(file)) {
    const body = readFileSync(file, "utf8");
    if (!body.includes("@spec"))
      warns.push("missing @spec annotation; add: @spec [Doc-ID_version, §section] | @implemented [YYYY-MM-DD] | plain English: ...");
  }
  const tryTool = (cmd, msg) => {
    try { execSync(cmd, { stdio: "ignore" }); }
    catch { warns.push(msg); }
  };
  // Only attempt if pnpm resolves; failures are advisory, never fatal.
  try { execSync("pnpm --version", { stdio: "ignore" });
    tryTool(`pnpm exec prettier --check "${file}"`, `prettier: not formatted (pnpm exec prettier --write "${file}")`);
    tryTool(`pnpm exec eslint "${file}"`, `eslint: rule violations in this file (pnpm exec eslint "${file}")`);
  } catch {}

  if (warns.length === 0) process.exit(0);
  const ctx =
    "Lyceon soft checks (pre-launch, non-blocking) on the file just edited:\n- " +
    warns.join("\n- ") +
    "\nThese become hard CI gates at hardening; fix now if quick.";
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx } }));
  process.exit(0);
});
