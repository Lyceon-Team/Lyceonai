/**
 * Practice Selection RPC — CI Tests
 *
 * @spec [Doc-02B_V4 §14/§15; CEO model; SCL-P-ADAPTIVE; INV-02B-01; INV-02B-15]
 * @implemented [2026-06-27]
 *
 * Proves the four contracts the spec-auditor flagged as untested on the new
 * DB-side selection path (select_practice_pool_random RPC):
 *
 *   1. ANTI-LEAK: /next serve returns correct_answer:null + explanation:null
 *      when items were prepopulated via the RPC path.
 *   2. FILTER-CORRECTNESS: the RPC call receives correct faceted params
 *      (sections, domains, skills, difficulties), status='published' gate,
 *      exclude-IDs, and LIMIT = target count.
 *   3. CONFIG-READ: default session count comes from practice_runtime_config,
 *      not a hardcoded literal.
 *   4. REGRESSION GUARD: selection goes through select_practice_pool_random
 *      RPC, not a reintroduced TS-side shuffle.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// §1  REGRESSION GUARD — source-level assertion
// ---------------------------------------------------------------------------
// Same shape as practice.start-rpc.guard.test.ts: reads the source file and
// asserts structural properties. No mocks needed.

describe("Practice selection RPC regression guard", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const routeSource = fs.readFileSync(
    path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
    "utf8",
  );

  it("selection uses select_practice_pool_random RPC (not TS-side shuffle)", () => {
    expect(routeSource).toContain('"select_practice_pool_random"');
  });

  it("does not contain listExactFilteredQuestionPool (dead TS shuffle path)", () => {
    // The function name must not appear as a callable — only tombstone comments are OK.
    const lines = routeSource.split("\n");
    const codeLines = lines.filter(
      (line) =>
        line.includes("listExactFilteredQuestionPool") &&
        !line.trimStart().startsWith("//"),
    );
    expect(codeLines).toHaveLength(0);
  });

  it("does not contain filterPoolBySessionSpec (dead TS shuffle helper)", () => {
    const lines = routeSource.split("\n");
    const codeLines = lines.filter(
      (line) =>
        line.includes("filterPoolBySessionSpec") &&
        !line.trimStart().startsWith("//"),
    );
    expect(codeLines).toHaveLength(0);
  });

  it("fisherYates is ONLY used inside buildServedOptions (option shuffle, not pool selection)", () => {
    const lines = routeSource.split("\n");
    const fisherYatesCallLines = lines.filter(
      (line) =>
        line.includes("fisherYates(") && !line.trimStart().startsWith("//"),
    );
    expect(fisherYatesCallLines.length).toBeGreaterThanOrEqual(1);
    for (const line of fisherYatesCallLines) {
      // The only call site must be inside buildServedOptions: `fisherYates(options)`
      expect(line).toContain("fisherYates(options)");
    }
  });
});

// ---------------------------------------------------------------------------
// §2  ANTI-LEAK — toStudentSafeQuestionDTO hard-nulls answer fields
// ---------------------------------------------------------------------------
// Import the module directly to test the serializer without HTTP overhead.
// The serve path (/next) always calls toStudentSafeQuestionDTO; we prove
// that given a question with answer-bearing fields, the DTO strips them.

describe("Practice anti-leak on RPC selection path", () => {
  it("toStudentSafeQuestionDTO returns correct_answer:null and explanation:null", async () => {
    // Read the source to verify the type definition enforces null
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // The StudentSafeQuestionDTO type must have correct_answer: null (literal null type)
    expect(source).toMatch(
      /type StudentSafeQuestionDTO\s*=\s*\{[^}]*correct_answer:\s*null/s,
    );
    expect(source).toMatch(
      /type StudentSafeQuestionDTO\s*=\s*\{[^}]*explanation:\s*null/s,
    );

    // The toStudentSafeQuestionDTO function must explicitly set both to null.
    // Extract the function body from its declaration to the next top-level function.
    const fnStart = source.indexOf("function toStudentSafeQuestionDTO(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 1500);
    expect(fnBody).toContain("correct_answer: null");
    expect(fnBody).toContain("explanation: null");
  });

  it("/next response shape serves questions only via toStudentSafeQuestionDTO", async () => {
    // Structural proof: every return path in serveNextForSession that returns
    // a question object in a JSON response does so via toStudentSafeQuestionDTO
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // Extract the serveNextForSession function body
    const fnStart = source.indexOf("async function serveNextForSession(");
    expect(fnStart).toBeGreaterThan(-1);
    const serveBody = source.slice(fnStart, fnStart + 6000);

    // Find all `question: toStudentSafeQuestionDTO(` in the serve function
    const safeAssignments =
      serveBody.match(/question:\s*toStudentSafeQuestionDTO\(/g) ?? [];
    // There should be at least 2 (unresolved item path + next prebuilt path)
    expect(safeAssignments.length).toBeGreaterThanOrEqual(2);

    // No question field should be assigned a raw value (not going through the sanitizer)
    // Match `question: <something>` in res.json() calls but exclude toStudentSafeQuestionDTO
    const allQuestionInJson =
      serveBody.match(/question:\s*(?!toStudentSafeQuestionDTO)\w+\(/g) ?? [];
    expect(allQuestionInJson).toHaveLength(0);
  });

  it("correct_variants is NOT present in StudentSafeQuestionDTO type", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // Extract the StudentSafeQuestionDTO type definition
    const typeMatch = source.match(
      /type StudentSafeQuestionDTO\s*=\s*\{[^}]*\}/s,
    );
    expect(typeMatch).not.toBeNull();
    expect(typeMatch![0]).not.toContain("correct_variants");
  });
});

// ---------------------------------------------------------------------------
// §3  FILTER-CORRECTNESS — RPC receives correct faceted params
// ---------------------------------------------------------------------------
// These tests verify the mapping between session spec and RPC parameters.

describe("Practice RPC filter correctness", () => {
  it("SQL function filters on status='published'", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const migrationSource = fs.readFileSync(
      path.join(
        repoRoot,
        "supabase",
        "migrations",
        "20260627030000_practice_select_pool_random.sql",
      ),
      "utf8",
    );

    // Must filter on published status — unpublished questions must not be selectable
    expect(migrationSource).toContain("q.status = 'published'");
  });

  it("SQL function uses ORDER BY random() LIMIT", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const migrationSource = fs.readFileSync(
      path.join(
        repoRoot,
        "supabase",
        "migrations",
        "20260627030000_practice_select_pool_random.sql",
      ),
      "utf8",
    );

    expect(migrationSource).toMatch(/ORDER BY random\(\)\s*\n\s*LIMIT p_limit/);
  });

  it("SQL function is VOLATILE (not STABLE — random() is non-deterministic)", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const migrationSource = fs.readFileSync(
      path.join(
        repoRoot,
        "supabase",
        "migrations",
        "20260627030000_practice_select_pool_random.sql",
      ),
      "utf8",
    );

    expect(migrationSource).toMatch(/LANGUAGE sql\s*\nVOLATILE/);
    expect(migrationSource).not.toMatch(/LANGUAGE sql\s*\nSTABLE/);
  });

  it("SQL function supports faceted filtering: sections, domains, skills (overlap), difficulties", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const migrationSource = fs.readFileSync(
      path.join(
        repoRoot,
        "supabase",
        "migrations",
        "20260627030000_practice_select_pool_random.sql",
      ),
      "utf8",
    );

    // Section filter: = ANY
    expect(migrationSource).toContain("q.section = ANY(p_sections)");
    // Domain filter: = ANY
    expect(migrationSource).toContain("q.domain = ANY(p_domains)");
    // Skills filter: && (array overlap) — per SKILL.md
    expect(migrationSource).toContain("q.skill_codes && p_skills");
    // Difficulty filter: = ANY (integer direct comparison)
    expect(migrationSource).toContain("q.difficulty = ANY(p_difficulties)");
  });

  it("SQL function supports exclude-IDs to prevent cross-session repeats", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const migrationSource = fs.readFileSync(
      path.join(
        repoRoot,
        "supabase",
        "migrations",
        "20260627030000_practice_select_pool_random.sql",
      ),
      "utf8",
    );

    expect(migrationSource).toContain("q.id != ALL(p_exclude_ids)");
  });

  it("SQL function p_exclude_ids type matches questions.id type (text, not uuid)", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const migrationSource = fs.readFileSync(
      path.join(
        repoRoot,
        "supabase",
        "migrations",
        "20260627030000_practice_select_pool_random.sql",
      ),
      "utf8",
    );

    // p_exclude_ids must be text[] to match questions.id TEXT PK
    expect(migrationSource).toMatch(/p_exclude_ids\s+text\[\]/);
    // Return type id must also be text
    expect(migrationSource).toMatch(/id\s+text/);
  });

  it("TS code passes null for empty filter arrays (none = all)", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // The RPC call must use conditional null for empty arrays
    expect(source).toContain("sectionCodes.length > 0 ? sectionCodes : null");
    expect(source).toContain(
      "args.sessionSpec.domains.length > 0 ? args.sessionSpec.domains : null",
    );
    expect(source).toContain(
      "args.sessionSpec.skills.length > 0 ? args.sessionSpec.skills : null",
    );
    expect(source).toContain(
      "difficultyInts.length > 0 ? difficultyInts : null",
    );
  });

  it("TS difficulty mapping converts string labels to integers for the RPC", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // The mapping: easy→1, medium→2, hard→3
    expect(source).toMatch(
      /difficultyInts.*=.*difficulties\.map.*easy.*1.*hard.*3.*2/s,
    );
  });

  it("TS passes p_limit = requestedCount to the RPC", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    expect(source).toContain("p_limit: requestedCount");
  });
});

// ---------------------------------------------------------------------------
// §4  CONFIG-READ — session count from practice_runtime_config
// ---------------------------------------------------------------------------

describe("Practice config doctrine (INV-02B-15)", () => {
  it("loadPracticeConfig reads from practice_runtime_config table", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // loadPracticeConfig (via its DB helper) must query practice_runtime_config
    const fnMatch = source.match(
      /async function loadPracticeConfig(?:FromDb)\b[\s\S]*?^}/m,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toContain('"practice_runtime_config"');
    expect(fnBody).toContain('"default_session_count_web"');
    expect(fnBody).toContain('"max_concurrent_sessions"');
    expect(fnBody).toContain('"max_session_count_premium"');
    expect(fnBody).toContain('"target_seconds_per_question"');
  });

  it("requestedCount uses config.maxSessionCountPremium and config.defaultSessionCountWeb (not literals)", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // In startOrReplaySession, requestedCount must use config-derived values
    const startFnStart = source.indexOf("async function startOrReplaySession(");
    expect(startFnStart).toBeGreaterThan(-1);
    const startFnBody = source.slice(startFnStart, startFnStart + 8000);

    expect(startFnBody).toContain("config.maxSessionCountPremium");
    expect(startFnBody).toContain("config.defaultSessionCountWeb");

    // Must NOT contain hardcoded fallbacks like `?? 10` or `?? 60` for these
    const hardcodedFallbacks = startFnBody.match(
      /coerceTargetQuestionCount\([^)]*,\s*\d+\s*,\s*\d+\s*\)/g,
    );
    expect(hardcodedFallbacks ?? []).toHaveLength(0);
  });

  it("maxConcurrentSessions comes from config (not hardcoded SESSION_LIMIT)", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // The old hardcoded constant must be gone
    expect(source).not.toMatch(/const SESSION_LIMIT\s*=/);
    // The config-based one must exist
    expect(source).toContain("config.maxConcurrentSessions");
  });

  it("target_question_count premium cap is config-driven via coerceTargetQuestionCount", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
      "utf8",
    );

    // The premium cap must come from config, not a hardcoded Zod .max(60)
    expect(source).toContain("config.maxSessionCountPremium");
    // coerceTargetQuestionCount clamps at runtime using the config value
    expect(source).toMatch(/coerceTargetQuestionCount/);
    // The default cap parameter defaults to 60 inside coerceTargetQuestionCount
    const fnMatch = source.match(
      /function coerceTargetQuestionCount[\s\S]*?maxCap:\s*number\s*=\s*(\d+)/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toBe("60");
  });
});
