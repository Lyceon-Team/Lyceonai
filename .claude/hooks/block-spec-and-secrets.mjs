#!/usr/bin/env node
// PreToolUse (matcher: Write|Edit). HARD-BLOCK three catastrophic classes:
//   1. writes to docs/Spec/**  2. inline secrets  3. unmarked migrations
// Portable across macOS/Linux/Windows (node only — no bash dependency).
// process.exit(2) = block (stderr fed to Claude). exit(0) = allow.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let j = {};
  try { j = JSON.parse(raw); } catch {}
  const ti = j.tool_input || {};
  const file = ti.file_path || ti.path || "";
  const text = [ti.content, ti.new_string, ti.new_str, ti.replacement].filter(Boolean).join("\n");

  // 1. Locked spec corpus — read-only to the agent.
  if (/(^|\/)docs\/Spec\//.test(file)) {
    process.stderr.write(
      "BLOCKED: docs/Spec/ is the locked canonical corpus and is read-only to Claude Code.\n" +
      "Code conforms to the spec, never the reverse. If the spec must change, surface it to Karl.\n");
    process.exit(2);
  }

  // 2. Secrets in source.
  const secret = new RegExp(
    "(sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]{20,}" +
    "|SUPABASE_SERVICE_ROLE_KEY\\s*[:=]\\s*[\"'][^\"' ]{20,}" +
    "|-----BEGIN [A-Z ]*PRIVATE KEY-----" +
    "|eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,})");
  if (secret.test(text)) {
    process.stderr.write(
      "BLOCKED: a plaintext secret/credential appears in this write.\n" +
      "Secrets load from validated env (packages/shared/env.ts). Never inline keys, tokens, or private keys.\n");
    process.exit(2);
  }

  // 3. Migrations are irreversible — require an explicit reviewed marker.
  if (/supabase\/migrations\/.*\.sql$/.test(file) && !/LYCEON-MIGRATION-REVIEWED/.test(text)) {
    process.stderr.write(
      "BLOCKED: migration write without a 'LYCEON-MIGRATION-REVIEWED' marker.\n" +
      "Every migration must have a reviewed rollback (INV-06: every-migration-has-rollback).\n" +
      "Add the marker comment only after the rollback path is written and confirmed.\n");
    process.exit(2);
  }

  process.exit(0);
});
