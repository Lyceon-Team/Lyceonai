#!/usr/bin/env node
/**
 * SCL register duplicate-id gate.
 *
 * Fails the build if any `SCL-NNN` appears more than once as an ENTRY HEADING in
 * docs/SpecAudit/SPEC_CHANGES_LOG.md.
 *
 * Why this exists as a gate and not just a rule:
 *
 * Id collisions keep reaching the register — SCL-021, SCL-024, SCL-042,
 * SCL-043, and on 2026-09-26 SCL-171/SCL-172 twice over. Every one was written
 * by an agent that had read the register first. Reading does not reserve: two
 * sessions on branches that cannot see each other both read max=N and both
 * write N+1. No instruction prevents that, because neither session did anything
 * wrong at the moment it looked. Only a mechanical check at merge time closes
 * the window.
 *
 * The 2026-09-26 round is the sharpest evidence for that. One pair renumbered
 * out of a collision with E9b and landed on SCL-171/SCL-172; a second session
 * allocated the same two ids the same morning from a scan that was correct when
 * it ran (that second pair is now SCL-176/SCL-177); and a third claimed
 * SCL-173/SCL-174 within three minutes of a fourth session naming them as the
 * next free pair. Four sessions, no mistakes, three collisions.
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
 * Allowlist for collisions that PREDATE this gate. EMPTY, and that is the
 * intended end state: the register now has no duplicate heading at all.
 *
 * It held two ids and both are spent, on 2026-09-26:
 *   SCL-021 — already stale when this was emptied. Its 2026-07-09 half had been
 *     renumbered to `SCL-069` at some earlier point and nobody removed the line,
 *     so the gate was announcing an ALLOWLISTED collision that no longer existed.
 *     Exactly the failure the EXPIRY note below warns about, found by counting
 *     headings rather than trusting this map.
 *   SCL-024 — resolved for real: the 2026-08-06 entry became `SCL-175`. Every
 *     citation outside the register named the 08-04 entry, which kept its id.
 *
 * The owner lifted the "an agent may not renumber an owner-promoted entry"
 * constraint on 2026-09-26 for exactly this clean-up, which is what let both
 * close. The mechanism stays in place, unused, for the next pre-existing
 * collision — it is an exact-count allowlist, not a mute: a listed id is
 * permitted exactly two headings and a third fails. Any id not listed fails on
 * its first duplicate. Weakening the comparison instead — skipping ids, or
 * dropping to a warning — would make the gate green by making it blind, which
 * is worse than no gate.
 *
 * EXPIRY: remove each line the moment its collision is resolved. If one is
 * still here once the owner has ruled, the gate is carrying debt that is no
 * longer anyone's open question — that is the point at which it starts lying.
 */
const KNOWN_COLLISIONS = new Map([]);

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
