/**
 * @spec [LISA-AUDIT-566-002: guards fail open on I/O errors]
 * @implemented 2026-08-14
 *
 * plain English: Proves that the bounded-window scanner (used by mastery and
 * notification guards) fails closed on I/O errors — a guard that cannot read
 * what it guards must FAIL, not pass silently.
 *
 * Proofs:
 *   (a) scanFileWithBoundedWindow throws on unreadable file
 *   (b) findTypeScriptFiles throws on non-existent directory
 *   (c) assertRootsExist throws on non-existent root
 *   (d) assertRootsExist throws on file (not directory)
 *   (e) assertRootsExist passes on existing directory
 *   (f) happy-path scanning still works (no regression)
 */
import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  scanFileWithBoundedWindow,
  findTypeScriptFiles,
  assertRootsExist,
} from "./bounded-window-scanner";

// ── Fixture: temp file for happy-path test ──────────────────────────

const TEMP_DIR = path.join(__dirname, "__scanner_test_tmp__");
const TEMP_FILE = path.join(TEMP_DIR, "sample.ts");

// Create a sample file with a known pattern
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.writeFileSync(
  TEMP_FILE,
  [
    'const x = supabaseServer.from("notifications")',
    '  .insert({ user_id: "abc" });',
    "",
    "const y = 42;",
  ].join("\n"),
  "utf-8",
);

afterAll(() => {
  // Clean up
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────

describe("Bounded-window scanner — fail-closed proofs (LISA-AUDIT-566-002)", () => {
  // ── Proof (a): unreadable file → throw ──────────────────────────

  it("(a) scanFileWithBoundedWindow throws on non-existent file", () => {
    expect(() =>
      scanFileWithBoundedWindow(
        "/nonexistent/path/to/file.ts",
        /\.from/,
        /\.insert/,
      ),
    ).toThrow();
  });

  // ── Proof (b): non-existent directory → throw ──────────────────

  it("(b) findTypeScriptFiles throws on non-existent directory", () => {
    expect(() =>
      findTypeScriptFiles("/nonexistent/path/to/directory"),
    ).toThrow();
  });

  // ── Proof (c): assertRootsExist — non-existent root → throw ────

  it("(c) assertRootsExist throws on non-existent root", () => {
    expect(() =>
      assertRootsExist(["/nonexistent/root/that/does/not/exist"]),
    ).toThrow(/does not exist/);
  });

  // ── Proof (d): assertRootsExist — file (not dir) → throw ──────

  it("(d) assertRootsExist throws when root is a file, not a directory", () => {
    expect(() => assertRootsExist([TEMP_FILE])).toThrow(/not a directory/);
  });

  // ── Proof (e): assertRootsExist — existing directory → passes ──

  it("(e) assertRootsExist passes on existing directory", () => {
    expect(() => assertRootsExist([TEMP_DIR])).not.toThrow();
  });

  // ── Proof (f): happy-path scanning still works ────────────────

  it("(f) scanFileWithBoundedWindow detects pattern in valid file (no regression)", () => {
    const hits = scanFileWithBoundedWindow(
      TEMP_FILE,
      /\.from\s*\(\s*["'`]notifications["'`]\s*\)/,
      /\.from\s*\(\s*["'`]notifications["'`]\s*\).*\.insert\s*\(/,
    );

    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it("(f) findTypeScriptFiles finds .ts files in existing directory", () => {
    const files = findTypeScriptFiles(TEMP_DIR);

    expect(files).toHaveLength(1);
    expect(files[0]).toBe(TEMP_FILE);
  });
});
