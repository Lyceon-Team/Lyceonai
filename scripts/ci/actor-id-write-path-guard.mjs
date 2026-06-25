#!/usr/bin/env node
// ============================================================================
// INV-05E-06 actor_id write-path guard (static grep)
// ============================================================================
// @spec [Doc-05E §8 step 2, INV-05E-06]
// Scans every .insert({ targeting the 5 activity tables for the presence of
// actor_id in the insert object. Catches omissions at CI time.
//
// LIMITATION: this guard uses line-range heuristics. It will NOT catch:
//   - Dynamic inserts built via computed property names
//   - Inserts constructed across non-contiguous code paths
// Backstops: G6 schema guard (no DEFAULT on actor_id) + NOT NULL (5c-tail).
// ============================================================================

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ACTIVITY_TABLES = [
  "practice_sessions",
  "practice_session_items",
  "review_sessions",
  "review_session_items",
  "review_error_attempts",
];

const SCAN_DIRS = ["server/routes", "server/lib", "apps/api/src"];
const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

function walk(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walk(full));
      } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
        results.push(full);
      }
    }
  } catch {
    // directory may not exist in all environments
  }
  return results;
}

/**
 * Scan a brace-delimited block starting at `lines[startLine]` from the first
 * `{` or `[` found. Returns true if `actor_id` appears anywhere in the block.
 */
function blockContainsActorId(lines, startLine, maxLines) {
  let braceDepth = 0;
  let started = false;
  const end = Math.min(startLine + maxLines, lines.length);
  for (let k = startLine; k < end; k++) {
    const line = lines[k];
    for (const ch of line) {
      if (ch === "{" || ch === "[") {
        braceDepth++;
        started = true;
      }
      if (ch === "}" || ch === "]") braceDepth--;
    }
    if (/actor_id/.test(line)) return true;
    if (started && braceDepth <= 0) return false;
  }
  return false;
}

let failures = 0;

for (const scanDir of SCAN_DIRS) {
  const absDir = join(ROOT, scanDir);
  for (const file of walk(absDir)) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      for (const table of ACTIVITY_TABLES) {
        const fromPattern = new RegExp(
          `\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`,
        );
        if (!fromPattern.test(lines[i])) continue;

        // Look ahead at most 5 lines for a chained .insert( — tightly coupled
        let insertLine = -1;
        const chainEnd = Math.min(i + 5, lines.length);
        for (let j = i + 1; j < chainEnd; j++) {
          // Chain is broken by a semicolon-terminated line or a line that
          // doesn't start with a dot (continuation)
          if (/\.insert\s*\(/.test(lines[j])) {
            insertLine = j;
            break;
          }
          // If the line doesn't look like a chained call, stop
          if (!/^\s*\./.test(lines[j]) && !/\.insert\s*\(/.test(lines[j])) {
            break;
          }
        }
        // Also check the same line (e.g. .from("t").insert({...}))
        if (insertLine === -1 && /\.insert\s*\(/.test(lines[i])) {
          insertLine = i;
        }

        if (insertLine === -1) continue; // .from() without chained .insert() — SELECT, UPDATE, etc.

        // Determine if .insert() takes an inline object or a variable reference
        const insertCall = lines[insertLine];
        const afterInsert = insertCall.replace(/^.*\.insert\s*\(\s*/, "");

        let foundActorId = false;

        if (/^\s*\{/.test(afterInsert) || /^\s*\[/.test(afterInsert)) {
          // Inline object/array — scan the block
          foundActorId = blockContainsActorId(lines, insertLine, 80);
        } else {
          // Variable reference — extract the variable name and search for its definition
          const varMatch = afterInsert.match(/^(\w+)/);
          if (varMatch) {
            const varName = varMatch[1];
            // Search backward for the variable definition and check if actor_id is in it
            for (let k = insertLine - 1; k >= Math.max(0, insertLine - 120); k--) {
              const defPattern = new RegExp(
                `(?:const|let|var)\\s+${varName}\\b`,
              );
              if (defPattern.test(lines[k])) {
                foundActorId = blockContainsActorId(lines, k, 80);
                break;
              }
            }
          }
        }

        if (!foundActorId) {
          const rel = relative(ROOT, file);
          failures++;
          console.error(
            `INV-05E-06 FAIL: ${rel}:${insertLine + 1} — .insert() into "${table}" is missing actor_id`,
          );
        }
      }
    }
  }
}

if (failures > 0) {
  console.error(
    `\nINV-05E-06 ACTOR_ID WRITE-PATH GUARD: ${failures} FAILURE(S)`,
  );
  process.exit(1);
} else {
  console.log("INV-05E-06 ACTOR_ID WRITE-PATH GUARD: PASS");
}
