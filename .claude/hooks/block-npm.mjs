#!/usr/bin/env node
// PreToolUse (matcher: Bash). HARD-BLOCK npm/npx (pnpm only). exit(2) = block.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let j = {};
  try { j = JSON.parse(raw); } catch {}
  const cmd = (j.tool_input && j.tool_input.command) || "";
  // Match npm/npx as a whole word; the lookbehind prevents matching inside "pnpm".
  if (/(?<![\w])(npm|npx)(?![\w])/.test(cmd)) {
    process.stderr.write(
      "BLOCKED: npm/npx is prohibited. Use pnpm.\n" +
      "Allowed: pnpm install | pnpm test | pnpm -s run build | pnpm lint\n");
    process.exit(2);
  }
  process.exit(0);
});
