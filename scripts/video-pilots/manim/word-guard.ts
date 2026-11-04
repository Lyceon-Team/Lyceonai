/**
 * Video pilots: the word guard. No pilot script, on-screen line or caption may name the
 * third-party graphing calculator.
 *
 * @spec [owner ruling (Karl, 2026-11-02), owner brief "Video tools pilot" Part D1: "Do NOT show the
 *       Desmos interface, logo or screenshots, and never use the word 'Desmos' in on-screen text,
 *       captions or spoken lines ... Add a test or a check in check.ts that fails if 'desmos'
 *       (case-insensitive) appears in any pilot script, on-screen line or caption"]
 *       | @implemented [2026-11-02]
 *
 * plain English: the word is matched case-insensitively anywhere, inside other words too
 * ("MyDesmosGraph" is caught), because a near miss on a brand is still the brand. Three places run
 * it: prepare.ts refuses an example that contains it before anything is voiced or drawn; check.ts
 * fails (exit 1) when a rendered video's log has it in a spoken line or in anything set on screen,
 * captions included; and tests/ci/video-pilots.test.ts scans every committed pilot source
 * (video-kit/pilots/ and scripts/video-pilots/manim/pilots/) on every test run. Each hit names its
 * place and its 1-based line, so a failure points at the line to fix.
 *
 * trade-offs: this file, the test and the README name the word in order to guard it; none of them
 * is a pilot script, so none is scanned. Nothing here logs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The calculator's brand, matched case-insensitively anywhere in a line. */
export const PILOT_BANNED_WORD = /desmos/i;

export type WordHit = { where: string; line: number; text: string };

/** Every line of `content` that names the brand, with its 1-based line number. */
export function bannedWordHits(where: string, content: string): WordHit[] {
  const hits: WordHit[] = [];
  content.split("\n").forEach((text, k) => {
    if (PILOT_BANNED_WORD.test(text))
      hits.push({ where, line: k + 1, text: text.trim() });
  });
  return hits;
}

/** The committed pilot sources: every file under video-kit/pilots/ and the pilot scene modules. */
export const PILOT_SOURCE_DIRS: readonly string[] = [
  "video-kit/pilots",
  "scripts/video-pilots/manim/pilots",
];

function filesUnder(root: string, dir: string): string[] {
  const abs = join(root, dir);
  const out: string[] = [];
  for (const name of readdirSync(abs).sort()) {
    if (name === "__pycache__") continue;
    const path = join(abs, name);
    if (statSync(path).isDirectory())
      out.push(...filesUnder(root, relative(root, path)));
    else out.push(relative(root, path));
  }
  return out;
}

export function pilotSourceFiles(root: string): string[] {
  return PILOT_SOURCE_DIRS.flatMap((d) => filesUnder(root, d));
}

/** Every hit in the committed pilot sources, as "path:line". */
export function pilotSourceHits(root: string): WordHit[] {
  return pilotSourceFiles(root).flatMap((rel) =>
    bannedWordHits(rel, readFileSync(join(root, rel), "utf8")),
  );
}

export function formatHit(h: WordHit): string {
  return `${h.where}:${h.line}: names the third-party calculator ("${h.text}")`;
}
