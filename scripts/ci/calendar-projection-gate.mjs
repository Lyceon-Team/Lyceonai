#!/usr/bin/env node
/**
 * The calendar never recomputes Doc 05C's projection. It adds two rows.
 *
 * @spec [Doc 05F §17.1; Doc 05C §7; owner ruling 2026-09-24 — "read 1:1 from Doc 05C and
 *        never recompute"] @implemented [2026-09-24]
 *
 * WHY A GATE AND NOT A CODE REVIEW. "Compose it the way Doc 05C composes it" is a rule that
 * degrades silently. Nobody sets out to write a second projection model; they add a
 * midpoint for a tooltip, clamp a band to 400..1600 because a fixture looked odd, or divide
 * to get an average — and each of those is one line that looks like formatting and is
 * actually the calendar forming its own opinion about a student's score. The failure is
 * invisible until a student sees one number in the header and a different one on the
 * dashboard, with nothing on screen saying which is true.
 *
 * WHAT IT CHECKS. In `client/src/features/calendar/lib/projection.ts`, with comments and
 * string literals blanked (prose describing the rule is not the rule): no `-`, `*`, `/` or
 * `%` as arithmetic, no `Math.*`, no `.reduce(`, no `toFixed`. `+` is permitted — summing
 * the two section scores is what a composite IS.
 *
 * It scans ONE file deliberately. The rule is "this composition lives in one place"; a
 * repo-wide ban on `*` would be noise, and a second file doing projection arithmetic is
 * caught by the fact that this one is the only thing the header imports.
 *
 * Exit 1 naming the line. `--selftest` proves it can refuse.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TARGET = "client/src/features/calendar/lib/projection.ts";

/**
 * Source with comments and string literals blanked, length and newlines preserved so a
 * reported line number still points at the real file. Same approach as the nested-anchor
 * gate, and for the same reason: a gate that punishes DESCRIBING the banned thing teaches
 * people to stop describing it.
 */
function blankNonCode(src) {
  const out = src.split("");
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      let end = src.indexOf("\n", i);
      if (end === -1) end = src.length;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && next === "*") {
      let end = src.indexOf("*/", i + 2);
      end = end === -1 ? src.length : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        j += 1;
      }
      blank(i + 1, Math.min(j, src.length));
      i = Math.min(j + 1, src.length);
      continue;
    }
    i += 1;
  }
  return out.join("");
}

const BANNED = [
  // ` - ` spaced, so a negative literal or an arrow is not a hit.
  [/\s-\s/, "subtraction"],
  [/\*/, "multiplication"],
  // ` / ` spaced, so an import path or a URL in code is not a hit.
  [/\s\/\s/, "division"],
  [/\s%\s/, "modulo"],
  [/\bMath\.[a-z]/i, "Math.* (rounding, clamping or averaging)"],
  [
    /\.reduce\(/,
    "reduce (fold it by hand or it stops being obvious what is summed)",
  ],
  [/\btoFixed\b/, "toFixed"],
];

function findViolations(raw) {
  const scanned = blankNonCode(raw);
  const hits = [];
  scanned.split("\n").forEach((line, idx) => {
    for (const [re, what] of BANNED) {
      if (re.test(line)) {
        hits.push({
          line: idx + 1,
          what,
          text: raw.split("\n")[idx].trim().slice(0, 80),
        });
      }
    }
  });
  return hits;
}

function selftest() {
  const cases = [
    ["a bare sum is clean", "low = low + row.projectedScoreLow;", 0],
    ["a midpoint is caught", "const mid = (lo + hi) / 2;", 1],
    ["Math.round is caught", "return Math.round(total);", 1],
    ["a width is caught", "const width = hi - lo;", 1],
    ["reduce is caught", "sections.reduce((a, b) => a + b.low, 0);", 1],
    [
      "a comment describing division is NOT caught",
      "// never a / b — the calendar does not average",
      0,
    ],
    ["a string mentioning it is NOT caught", 'const msg = "low / high";', 0],
    ["an arrow function is not subtraction", "const f = (a) => a.section;", 0],
    ["an import path is not division", 'import x from "@lyceon/shared";', 0],
  ];
  let bad = 0;
  for (const [label, src, expected] of cases) {
    const got = findViolations(src).length;
    const ok = got === expected;
    if (!ok) bad += 1;
    process.stdout.write(
      `  ${ok ? "ok  " : "FAIL"} ${label} (expected ${expected}, got ${got})\n`,
    );
  }
  process.stdout.write(
    bad
      ? `PROJECTION GATE SELF-TEST: FAIL (${bad})\n`
      : "PROJECTION GATE SELF-TEST: PASS\n",
  );
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes("--selftest")) selftest();

const path = resolve(process.cwd(), TARGET);
const raw = readFileSync(path, "utf8");
const hits = findViolations(raw);

if (hits.length > 0) {
  for (const h of hits) {
    process.stderr.write(
      `PROJECTION ARITHMETIC  ${TARGET}:${h.line}  ${h.what}\n    ${h.text}\n`,
    );
  }
  process.stderr.write(
    `\nCALENDAR PROJECTION GATE: ${hits.length} operation(s) beyond the sum.\n` +
      `Doc 05C owns the projection. The calendar adds the section rows and renders them;\n` +
      `any other arithmetic here is a second opinion about a student's score.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `CALENDAR PROJECTION GATE: PASS — ${TARGET} composes by addition only\n`,
);
