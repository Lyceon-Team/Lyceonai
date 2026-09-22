#!/usr/bin/env node
/**
 * Zero nested anchors. One anchor per link, and it carries the href.
 *
 * @spec [issue #829; owner ruling 2026-09-22 — exempt by SHAPE, never by filename]
 * @implemented 2026-09-22
 *
 * WHAT IS BANNED. The wouter v2 idiom: a `<Link>` whose immediate child is a bare `<a>`.
 * Under wouter 3 that renders `<a href><a data-testid>` — React warns `validateDOMNesting`,
 * and the INNER anchor, the one carrying the testid, the label and the click target, has no
 * `href` at all. Middle-click, ⌘/ctrl-click, open-in-new-tab, copy-link-address and screen
 * reader link announcement are all dead on it. A plain left click still works, which is the
 * only reason sixteen files carried it across four surfaces without anyone noticing.
 *
 * WHAT IS NOT BANNED, AND WHY THE EXEMPTION IS BY SHAPE. `<Button asChild><Link …>…</Link>`
 * is the CORRECT v3 idiom: `asChild` makes wouter clone its child with `href` and `onClick`
 * instead of rendering an anchor (wouter@3.9.0 src/index.js:308-309), so exactly one element
 * carries the href. Three such sites exist in `lyceon-dashboard.tsx` today.
 *
 * The exemption is written against the `asChild` TOKEN, not against those filenames. A
 * filename allow-list is the accept-list problem: it grows, it goes stale, and it exempts
 * whatever a file later grows rather than the construct that was actually reviewed. This
 * pattern will recur in files nobody has written yet, and they should pass without anyone
 * editing this gate.
 *
 * Exit 1 naming every offending file and line. Exit 0 prints the count it scanned, because
 * a gate that cannot tell "clean" from "scanned nothing" is not measuring anything — pass
 * `--selftest` to see it go red against fixtures on demand.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["client/src"];
const EXT = /\.(tsx|jsx)$/;

/**
 * A `<Link …>` open tag whose next non-space character begins a bare `<a`.
 *
 * `[^>]*` is deliberately NOT used for the attributes: every `() =>` handler contains a
 * `>`, so that form stops mid-attribute and matches things it should not. Instead the
 * scanner walks the tag tracking brace depth and quotes, exactly as the codemod did.
 */
function findNestedAnchors(src) {
  const hits = [];
  const openTag = /<Link\b/g;
  let m;
  while ((m = openTag.exec(src)) !== null) {
    let i = m.index;
    let depth = 0;
    let quote = "";
    let end = -1;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
      } else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
      i += 1;
    }
    if (end === -1) continue;
    const tag = src.slice(m.index, end + 1);
    // THE SHAPE EXEMPTION. `asChild` means the child IS the anchor; there is no second one.
    if (/\basChild\b/.test(tag)) continue;
    if (tag.endsWith("/>")) continue;
    const after = src.slice(end + 1);
    const child = /^\s*<a\b/.exec(after);
    if (child === null) continue;
    hits.push({
      line: src.slice(0, m.index).split("\n").length,
      excerpt: tag.replace(/\s+/g, " ").slice(0, 90),
    });
  }
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules") continue;
      walk(full, out);
    } else if (EXT.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function selftest() {
  const cases = [
    ["bare anchor child is caught", '<Link href="/a">\n  <a className="x">t</a>\n</Link>', 1],
    ["asChild is exempt", '<Link href="/a" asChild>\n  <a>t</a>\n</Link>', 0],
    ["one anchor is clean", '<Link href="/a" className="x">t</Link>', 0],
    [
      "an arrow handler does not hide the child",
      '<Link href="/a" onClick={() => go()}>\n  <a>t</a>\n</Link>',
      1,
    ],
    ["a non-anchor child is fine", '<Link href="/a">\n  <span>t</span>\n</Link>', 0],
    ["self-closing Link is fine", '<Link href="/a" />\n<a>t</a>', 0],
  ];
  let bad = 0;
  for (const [label, src, expected] of cases) {
    const got = findNestedAnchors(src).length;
    const ok = got === expected;
    if (!ok) bad += 1;
    process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${label} (expected ${expected}, got ${got})\n`);
  }
  process.stdout.write(
    bad ? `NESTED-ANCHOR GATE SELF-TEST: FAIL (${bad})\n` : "NESTED-ANCHOR GATE SELF-TEST: PASS\n",
  );
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes("--selftest")) selftest();

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
let offenders = 0;
for (const file of files) {
  for (const hit of findNestedAnchors(readFileSync(file, "utf8"))) {
    process.stderr.write(
      `NESTED ANCHOR  ${relative(ROOT, file)}:${hit.line}  ${hit.excerpt}\n`,
    );
    offenders += 1;
  }
}

if (offenders > 0) {
  process.stderr.write(
    `\nNESTED-ANCHOR GATE: ${offenders} occurrence(s) of the wouter v2 idiom.\n` +
      `Put href, the testid, the class and the label on ONE <Link>; it spreads them onto\n` +
      `the anchor it renders. See issue #829.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `NESTED-ANCHOR GATE: PASS — 0 occurrences across ${files.length} .tsx/.jsx files in ${SCAN_DIRS.join(", ")}\n`,
);
