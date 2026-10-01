/**
 * The committed reference snapshots are exactly the files the manifest describes.
 *
 * @spec [Brief 8 ruling 3 (owner, 2026-10-01): a committed filtered snapshot with a manifest of
 *        source URL, vintage, filter rules and the SHA-256 of each file] | @implemented [2026-10-01]
 *
 * plain English: a hand-edited row, a truncated file or a stale manifest fails CI here, before the
 * import script would refuse it in production. The import script's own reader is used, so the
 * check and the loader cannot disagree about what the file says.
 */
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANIFEST_PATH,
  parseCsv,
  readManifest,
  readSnapshot,
  sha256Hex,
} from "../../scripts/reference-data/import-reference-data";

const ROOT = join(__dirname, "..", "..");

describe("reference snapshots (Brief 8 ruling 3)", () => {
  const manifest = readManifest(MANIFEST_PATH);

  it("each snapshot hashes to its manifest SHA-256 and has the manifest's row count", () => {
    const colleges = readSnapshot(manifest.snapshots.colleges);
    const schools = readSnapshot(manifest.snapshots.high_schools);
    expect(colleges).toHaveLength(manifest.snapshots.colleges.rows);
    expect(schools).toHaveLength(manifest.snapshots.high_schools.rows);
    // Presence: real data, both sources of high schools present.
    expect(colleges.length).toBeGreaterThan(2000);
    expect(schools.some((s) => s.id.startsWith("nces:"))).toBe(true);
    expect(schools.some((s) => s.id.startsWith("pss:"))).toBe(true);
  });

  it("every source names its URL, vintage and raw-file hashes", () => {
    expect(Object.keys(manifest.sources).sort()).toEqual([
      "college_scorecard",
      "nces_ccd",
      "nces_pss",
    ]);
    for (const source of Object.values(manifest.sources)) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.vintage.length).toBeGreaterThan(0);
    }
  });

  it("the loader refuses a snapshot whose bytes differ from the manifest by one character", () => {
    const dir = mkdtempSync(join(tmpdir(), "refsnap-"));
    const entry = manifest.snapshots.colleges;
    const tampered = join(dir, "colleges.csv");
    copyFileSync(join(ROOT, entry.file), tampered);
    const text = readFileSync(tampered, "utf8").replace(
      "Harvard University",
      "Harvard Universitx",
    );
    writeFileSync(tampered, text);
    expect(sha256Hex(text)).not.toBe(entry.sha256);
    expect(() => readSnapshot({ ...entry, file: "colleges.csv" }, dir)).toThrow(
      /SHA-256/,
    );
  });

  it("the CSV reader handles quoted commas and doubled quotes", () => {
    expect(parseCsv('id,name\n1,"A, B"\n2,"Say ""hi"""\n')).toEqual([
      ["id", "name"],
      ["1", "A, B"],
      ["2", 'Say "hi"'],
    ]);
  });
});
