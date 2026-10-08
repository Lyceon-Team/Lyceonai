/**
 * @spec [Production QA 2026-10-07 item 15 ("one empty-day message")] | @implemented [2026-10-07]
 * plain English: the empty-day sentence is written once, in `lib/empty-day.ts`. Every shipped
 * file that says it imports `EMPTY_DAY_MESSAGE`; a second hand-written copy fails here, because
 * two copies drift (Home said "Rest day" while the calendar said "No study planned").
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_DAY_MESSAGE } from "./empty-day";

const SRC = path.resolve(__dirname, "..");

function shippedFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return shippedFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the empty-day message", () => {
  it("is written once: no shipped file but lib/empty-day.ts spells it out in code", () => {
    // Presence first: the constant is the sentence, and the calendar and Home import it.
    expect(EMPTY_DAY_MESSAGE).toBe("No study planned");
    const importers = shippedFiles(SRC).filter((f) =>
      /EMPTY_DAY_MESSAGE/.test(readFileSync(f, "utf8")),
    );
    expect(importers.map((f) => path.relative(SRC, f)).sort()).toEqual(
      expect.arrayContaining([
        "components/home/PaidHome.tsx",
        "features/calendar/components/WeekGrid.tsx",
      ]),
    );
    // A string literal (not a comment) carrying the sentence anywhere else is a second copy.
    const copies = shippedFiles(SRC)
      .filter((f) => !f.endsWith(path.join("lib", "empty-day.ts")))
      .filter((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .some(
            (line) =>
              !/^\s*(\*|\/\/)/.test(line) &&
              /["'`]No study planned["'`]/.test(line),
          ),
      )
      .map((f) => path.relative(SRC, f));
    expect(copies).toEqual([]);
  });
});
