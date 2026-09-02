#!/usr/bin/env node
/**
 * SCL register duplicate-id gate.
 *
 * Fails the build if any `SCL-NNN` appears more than once as an ENTRY HEADING in
 * docs/SpecAudit/SPEC_CHANGES_LOG.md.
 *
 * Why this exists as a gate and not just a rule:
 *
 * Three id collisions have reached the register — SCL-021, SCL-024, SCL-042 —
 * and a fourth (SCL-043) is in flight on two open PRs. Every one was written by
 * an agent that had read the register first. Reading does not reserve: two
 * sessions on branches that cannot see each other both read max=N and both
 * write N+1. No instruction prevents that, because neither session did anything
 * wrong at the moment it looked. Only a mechanical check at merge time closes
 * the window.
 *
 * Scope, deliberately: this checks ONE file for duplicate headings. It does not
 * try to detect cross-branch races itself — that needs the pre-write query in
 * the HARD OVERRIDE rule at the top of the register. This is the backstop that
 * catches what the rule misses.
 *
 * An entry heading is a line beginning `SCL-NNN | ` at column 0. Prose
 * references to an id elsewhere in the file (banners, cross-references,
 * "amends SCL-048") are NOT headings and are correctly ignored.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTER = resolve(ROOT, "docs/SpecAudit/SPEC_CHANGES_LOG.md");

/** `SCL-NNN | ` at the start of a line — the entry-heading shape. */
const ENTRY_HEADING = /^(SCL-\d{3}) \|/;

/**
 * Known collisions that PREDATE this gate, allowlisted so it can be switched on
 * without being switched straight off again.
 *
 * This is an exact-count allowlist, not a mute. `SCL-021` is permitted to head
 * exactly two entries; a third fails. Any id NOT listed here fails on its first
 * duplicate. Weakening the comparison instead — skipping these ids, or dropping
 * to a warning — would make the gate green by making it blind, which is worse
 * than no gate.
 *
 * Both are `OPEN (owner-promoted 2026-08-14)`. An agent may not renumber an
 * owner-promoted entry, so neither can be cleared here; both are reported to
 * the owner and await a ruling.
 *
 * EXPIRY: remove each line the moment its collision is resolved. If these are
 * still here once the owner has ruled, the gate is carrying debt that is no
 * longer anyone's open question — that is the point at which it starts lying.
 */
const KNOWN_COLLISIONS = new Map([
  [
    "SCL-021",
    "2026-07-01 grid-in correctness model vs 2026-07-09 practice grid-in serve+grade; 2 citations, both on the 07-01 entry",
  ],
  [
    "SCL-024",
    "2026-08-04 config table shape vs 2026-08-06 fifth question-FK column; 4 citations, all on the 08-04 entry (one as `SCL-024a`)",
  ],
]);

function main() {
  const lines = readFileSync(REGISTER, "utf-8").split("\n");

  /** id -> line numbers (1-based) where it heads an entry */
  const seen = new Map();
  lines.forEach((line, i) => {
    const m = ENTRY_HEADING.exec(line);
    if (!m) return;
    const id = m[1];
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(i + 1);
  });

  const duplicates = [...seen.entries()]
    .filter(([, at]) => at.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));

  console.log(
    `scl-duplicate-check: ${seen.size} distinct entry id(s) across ${lines.length} lines`,
  );

  // An allowlisted id is permitted EXACTLY two headings — the collision on
  // record. A third is new and fails like any other.
  const allowed = [];
  const failing = [];
  for (const [id, at] of duplicates) {
    if (KNOWN_COLLISIONS.has(id) && at.length === 2) {
      allowed.push([id, at]);
    } else {
      failing.push([id, at]);
    }
  }

  for (const [id, at] of allowed) {
    console.log(
      `  ALLOWLISTED ${id} (2 headings, lines ${at.join(", ")}) — ${KNOWN_COLLISIONS.get(id)}`,
    );
    console.log("      pre-dates this gate; owner-promoted; awaiting ruling");
  }

  if (failing.length === 0) {
    console.log(
      `SCL DUPLICATE GATE: PASS${allowed.length ? ` (${allowed.length} allowlisted, none new)` : ""}`,
    );
    return 0;
  }

  console.log("");
  console.log("SCL DUPLICATE GATE: FAIL");
  console.log("");
  for (const [id, at] of failing) {
    console.log(
      `  ${id} heads ${at.length} entries, at lines ${at.join(", ")}`,
    );
    for (const ln of at) {
      console.log(`      ${ln}: ${lines[ln - 1].slice(0, 110)}`);
    }
  }
  console.log("");
  console.log(
    "  Two entries cannot share an id. Citations resolve by number, so a duplicate",
  );
  console.log(
    "  makes every reference to it ambiguous. Per the HARD OVERRIDE rule at the top",
  );
  console.log(
    "  of the register: the LATER allocation renumbers, measured by the entry's own",
  );
  console.log(
    "  date. Never renumber another workstream's branch — report it to the owner.",
  );
  return 1;
}

process.exit(main());
