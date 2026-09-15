/**
 * @spec [LYCEON legal versioning — billing-terms wiring §6; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: the four claims wiring `billing-terms` into the structure
 * rests on, each written so that the obvious way to break it turns this file
 * red.
 *
 *   W1  /legal/billing-terms renders, with 1.0 and 2026-09-11 from meta.yml
 *   W2  every citation to billing-terms resolves, and the corpus total is right
 *   W3  removing meta.yml fails the manifest gate
 *   W4  a version or date left in the body fails the body-purity gate
 *
 * trade-offs: W3 and W4 run the REAL gate scripts against a throwaway copy of
 * `legal/`, the same way scripts/ci/legal-gates.selftest.sh does, rather than
 * reimplementing their rules here. A second implementation of a gate is a
 * second thing to drift.
 *
 * edge cases:
 *  - The directory is `v2/` while the version is `1.0`. That is deliberate:
 *    the directory name is positional, for consistency with a corpus whose
 *    other eight documents are all at v2; the `version` field records this
 *    document's own history, and it has no predecessor. Nobody should read
 *    `v2/` as "version 2.0" and go looking for a missing v1. W1 asserts the
 *    divergence explicitly so it cannot be quietly "corrected" later.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadLegalDocument } from "../../client/src/lib/legal-content";

const REPO_ROOT = path.resolve(__dirname, "../..");
const REAL_LEGAL = path.join(REPO_ROOT, "legal");

/** Serves the real legal/ tree at /legal/..., exactly as the deploy does. */
function stubFetchFromRealLegal(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    const abs = path.join(REAL_LEGAL, url.replace(/^\/legal\//, ""));
    if (!fs.existsSync(abs)) return new Response("not found", { status: 404 });
    return new Response(fs.readFileSync(abs, "utf-8"), { status: 200 });
  });
}

/**
 * A throwaway repo with the gate scripts and a copy of legal/, so a gate can be
 * watched turning red without touching the real tree.
 */
function sandbox(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "legal-billing-"));
  fs.mkdirSync(path.join(ws, "scripts/ci"), { recursive: true });
  for (const g of [
    "legal-manifest-gate.mjs",
    "legal-body-purity-gate.mjs",
    "legal-xref-gate.mjs",
  ]) {
    fs.copyFileSync(
      path.join(REPO_ROOT, "scripts/ci", g),
      path.join(ws, "scripts/ci", g),
    );
  }
  fs.cpSync(REAL_LEGAL, path.join(ws, "legal"), { recursive: true });
  return ws;
}

/** Runs a gate inside the sandbox. Returns its exit code and output. */
function runGate(ws: string, gate: string): { code: number; out: string } {
  try {
    const out = execFileSync("node", [path.join(ws, "scripts/ci", gate)], {
      cwd: ws,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      out: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

// ── W1 ──────────────────────────────────────────────────────────────────

describe("W1 — /legal/billing-terms renders from meta.yml", () => {
  beforeEach(stubFetchFromRealLegal);
  afterEach(() => vi.unstubAllGlobals());

  it("is published, not the unpublished placeholder it used to be", async () => {
    const doc = await loadLegalDocument("billing-terms");
    expect(doc.state).toBe("published");
  });

  it("reports version 1.0 and effective date 2026-09-11 from meta.yml", async () => {
    const doc = await loadLegalDocument("billing-terms");
    if (doc.state !== "published") throw new Error("expected published");
    expect(doc.version).toBe("1.0");
    expect(doc.effectiveDate).toBe("2026-09-11");
    expect(doc.title).toBe("LYCEON Billing Terms");
  });

  it("carries a hash that is the SHA-256 of the body actually served", async () => {
    const doc = await loadLegalDocument("billing-terms");
    if (doc.state !== "published") throw new Error("expected published");
    const served = fs.readFileSync(
      path.join(REAL_LEGAL, "billing-terms/v2/en.md"),
    );
    expect(doc.contentHash).toBe(
      `sha256:${createHash("sha256").update(served).digest("hex")}`,
    );
  });

  it("has a real body with sections, not an empty shell", async () => {
    const doc = await loadLegalDocument("billing-terms");
    if (doc.state !== "published") throw new Error("expected published");
    expect(doc.sections.length).toBeGreaterThan(5);
    expect(doc.sections.some((s) => s.title.includes("At a Glance"))).toBe(
      true,
    );
  });

  it("keeps version and date OUT of the body — they come from meta.yml alone", () => {
    const body = fs.readFileSync(
      path.join(REAL_LEGAL, "billing-terms/v2/en.md"),
      "utf-8",
    );
    // No frontmatter BLOCK, which is `---` as the very first line. A bare
    // `---` elsewhere is a horizontal rule, and this document uses several as
    // section separators — an earlier draft of this assertion banned those
    // too and failed on the real file.
    expect(body.startsWith("---")).toBe(false);
    expect(body.startsWith("# ")).toBe(true);
    expect(body).not.toMatch(/^version:/m);
    expect(body).not.toMatch(/^effective_date:/m);
    expect(body).not.toMatch(/^supersedes:/m);
  });

  it("records the v2-directory / 1.0-version divergence deliberately", () => {
    // The directory is positional; the version field is the document's own
    // history. Asserting both stops someone "fixing" one to match the other.
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(REAL_LEGAL, "billing-terms/manifest.json"),
        "utf-8",
      ),
    );
    expect(manifest.current).toBe("v2");
    const meta = fs.readFileSync(
      path.join(REAL_LEGAL, "billing-terms/v2/meta.yml"),
      "utf-8",
    );
    expect(meta).toMatch(/^version:\s*"1\.0"$/m);
    expect(meta).toMatch(/^supersedes:\s*null$/m);
    expect(meta).toMatch(/^published:\s*true$/m);
  });
});

// ── W2 ──────────────────────────────────────────────────────────────────

describe("W2 — every citation to billing-terms resolves", () => {
  it("resolves the whole corpus with no exceptions", () => {
    const ws = sandbox();
    try {
      const { code, out } = runGate(ws, "legal-xref-gate.mjs");
      expect(out).toContain("document references resolve to a slug");
      expect(code).toBe(0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("counts the billing-terms body in the corpus, not just the slug", () => {
    // Before this change the body was named `Lyceon billing terms`, so the
    // gate — which reads only *.md — never scanned it. 60 references across
    // eight bodies became 71 across nine when the file got its real name.
    const ws = sandbox();
    try {
      const { out } = runGate(ws, "legal-xref-gate.mjs");
      const total = /all (\d+) document references resolve/.exec(out);
      expect(total, "gate did not report a reference total").not.toBeNull();
      expect(Number(total?.[1])).toBeGreaterThanOrEqual(71);
      expect(out).toContain("9 slugs");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("goes red if the billing-terms slug disappears from under its citations", () => {
    const ws = sandbox();
    try {
      fs.rmSync(path.join(ws, "legal/billing-terms"), {
        recursive: true,
        force: true,
      });
      const { code, out } = runGate(ws, "legal-xref-gate.mjs");
      expect(code).not.toBe(0);
      expect(out).toMatch(/Billing Terms/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

// ── W3 ──────────────────────────────────────────────────────────────────

describe("W3 — removing meta.yml fails the manifest gate", () => {
  it("is green on the real tree", () => {
    const ws = sandbox();
    try {
      expect(runGate(ws, "legal-manifest-gate.mjs").code).toBe(0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("turns red, naming the version directory, when meta.yml is deleted", () => {
    const ws = sandbox();
    try {
      fs.rmSync(path.join(ws, "legal/billing-terms/v2/meta.yml"));
      const { code, out } = runGate(ws, "legal-manifest-gate.mjs");
      expect(code).not.toBe(0);
      expect(out).toContain("legal/billing-terms/v2 has no meta.yml");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("still names the missing body when meta.yml is gone too", () => {
    // The original defect: the gate stopped at the missing meta.yml and never
    // reached the locale-body check, so the misnamed body went unmentioned by
    // this gate and unseen by body purity. Both are reported now.
    const ws = sandbox();
    try {
      const v2 = path.join(ws, "legal/billing-terms/v2");
      fs.rmSync(path.join(v2, "meta.yml"));
      fs.renameSync(
        path.join(v2, "en.md"),
        path.join(v2, "Lyceon billing terms"),
      );
      const { code, out } = runGate(ws, "legal-manifest-gate.mjs");
      expect(code).not.toBe(0);
      expect(out).toContain("en.md is missing");
      expect(out).toContain("Lyceon billing terms");
      expect(out).toContain("has no meta.yml");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

// ── W4 ──────────────────────────────────────────────────────────────────

describe("W4 — a version or date left in the body fails body purity", () => {
  it("is green on the real tree", () => {
    const ws = sandbox();
    try {
      expect(runGate(ws, "legal-body-purity-gate.mjs").code).toBe(0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("turns red when the committed frontmatter is put back", () => {
    const ws = sandbox();
    try {
      const body = path.join(ws, "legal/billing-terms/v2/en.md");
      fs.writeFileSync(
        body,
        `---\ndocument: Billing Terms\nversion: 1.0\neffective_date: 2026-09-11\nsupersedes: null\n---\n\n` +
          fs.readFileSync(body, "utf-8"),
      );
      const { code, out } = runGate(ws, "legal-body-purity-gate.mjs");
      expect(code).not.toBe(0);
      expect(out).toContain("version key");
      expect(out).toContain("date key");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("turns red on a version header written as prose", () => {
    const ws = sandbox();
    try {
      const body = path.join(ws, "legal/billing-terms/v2/en.md");
      fs.appendFileSync(
        body,
        "\n**Version 1.0 · Effective 11 September 2026**\n",
      );
      expect(runGate(ws, "legal-body-purity-gate.mjs").code).not.toBe(0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
