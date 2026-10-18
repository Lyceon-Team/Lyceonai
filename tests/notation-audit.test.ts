import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runNotationAudit } from "../scripts/content/batch-notation-audit.js";

const TMP_DIR = join("content/official-corpus");
const BATCH_DIR = "/tmp/notation-audit-test-batch";

const TEST_SKILL_A = "Test Nonlinear Functions Audit";
const TEST_SKILL_A_SLUG = "test-nonlinear-functions-audit";
const TEST_SKILL_B = "Test Circles Audit";
const TEST_SKILL_B_SLUG = "test-circles-audit";

describe("per-batch notation audit", () => {
  beforeAll(() => {
    mkdirSync(BATCH_DIR, { recursive: true });
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(BATCH_DIR, { recursive: true, force: true });
    for (const f of [
      join(TMP_DIR, `${TEST_SKILL_A_SLUG}.ndjson`),
      join(TMP_DIR, `${TEST_SKILL_B_SLUG}.ndjson`),
    ]) {
      if (existsSync(f)) rmSync(f);
    }
  });

  describe("acceptance test 1: composition flagged as NOVEL_NOTATION", () => {
    it("flags nested_function_call when official corpus has zero instances", () => {
      const officialCorpus = [
        {
          official_id: "off-001",
          skill: TEST_SKILL_A,
          difficulty: "Easy",
          ocr_text:
            "If $f(x) = x^2 + 3$ and $g(x) = 2x - 1$, what is $f(5) + g(3)$?",
        },
        {
          official_id: "off-002",
          skill: TEST_SKILL_A,
          difficulty: "Medium",
          ocr_text:
            "The function $f$ is defined by $f(x) = 3x^2 - 5x + 2$. What is $f(-1)$?",
        },
        {
          official_id: "off-003",
          skill: TEST_SKILL_A,
          difficulty: "Hard",
          ocr_text:
            "Given $g(x) = x^3 - 4x$, for what value of $x$ does $g(x) = 0$?",
        },
      ];
      writeFileSync(
        join(TMP_DIR, `${TEST_SKILL_A_SLUG}.ndjson`),
        officialCorpus.map((q) => JSON.stringify(q)).join("\n") + "\n",
      );

      const batchQuestions = [
        {
          id: "lyceon-comp-001",
          skill: TEST_SKILL_A,
          skill_codes: [TEST_SKILL_A],
          stem: "If $f(x) = x^2$ and $g(x) = x + 1$, what is $f(g(2))$?",
          options: [
            { key: "A", text: "4" },
            { key: "B", text: "5" },
            { key: "C", text: "9" },
            { key: "D", text: "10" },
          ],
          correct_answer: "C",
          explanation: "g(2) = 3, f(3) = 9",
          section: "M",
          domain: "Advanced Math",
          difficulty: 2,
          item_type: "mcq",
        },
      ];
      writeFileSync(
        join(BATCH_DIR, "advanced-math.ndjson"),
        batchQuestions.map((q) => JSON.stringify(q)).join("\n") + "\n",
      );

      const result = runNotationAudit(BATCH_DIR);

      expect(result.pass).toBe(false);
      expect(result.findings.length).toBeGreaterThanOrEqual(1);

      const compFinding = result.findings.find(
        (f) =>
          f.question_id === "lyceon-comp-001" &&
          f.token === "nested_function_call",
      );
      expect(compFinding).toBeDefined();
      expect(compFinding!.severity).toBe("NOVEL_NOTATION");
      expect(compFinding!.official_count).toBe(0);
    });
  });

  describe("acceptance test 2: translations and degree symbols NOT flagged", () => {
    it("does not flag f(x+5) or g(x)=f(x-1) as nested_function_call", () => {
      const officialCorpus = [
        {
          official_id: "off-circ-001",
          skill: TEST_SKILL_B,
          difficulty: "Easy",
          ocr_text:
            "$(x-6)^2 + (y-3)^2 = 81$. The graph is a circle. What is the radius?",
        },
        {
          official_id: "off-circ-002",
          skill: TEST_SKILL_B,
          difficulty: "Medium",
          ocr_text:
            "A circle with center $(0,0)$ has radius 5. An angle of $45^\\circ$ is inscribed.",
        },
      ];
      writeFileSync(
        join(TMP_DIR, `${TEST_SKILL_B_SLUG}.ndjson`),
        officialCorpus.map((q) => JSON.stringify(q)).join("\n") + "\n",
      );

      rmSync(join(BATCH_DIR, "advanced-math.ndjson"), { force: true });

      const batchQuestions = [
        {
          id: "lyceon-trans-001",
          skill: TEST_SKILL_B,
          skill_codes: [TEST_SKILL_B],
          stem: "If $f(x) = x^2$, the graph of $g(x) = f(x+5)$ is a translation 5 units left.",
          options: [
            { key: "A", text: "Left" },
            { key: "B", text: "Right" },
            { key: "C", text: "Up" },
            { key: "D", text: "Down" },
          ],
          correct_answer: "A",
          explanation: "f(x+5) shifts left",
          section: "M",
          domain: "Geometry and Trigonometry",
          difficulty: 1,
          item_type: "mcq",
        },
        {
          id: "lyceon-degree-001",
          skill: TEST_SKILL_B,
          skill_codes: [TEST_SKILL_B],
          stem: "A central angle of $60^\\circ$ subtends an arc. What is the arc length if $r = 5$?",
          options: [
            { key: "A", text: "$\\frac{5\\pi}{3}$" },
            { key: "B", text: "$\\frac{10\\pi}{3}$" },
            { key: "C", text: "$5\\pi$" },
            { key: "D", text: "$10\\pi$" },
          ],
          correct_answer: "A",
          explanation: "Arc = r * theta = 5 * pi/3",
          section: "M",
          domain: "Geometry and Trigonometry",
          difficulty: 2,
          item_type: "mcq",
        },
      ];
      writeFileSync(
        join(BATCH_DIR, "geometry.ndjson"),
        batchQuestions.map((q) => JSON.stringify(q)).join("\n") + "\n",
      );

      const result = runNotationAudit(BATCH_DIR);

      expect(result.pass).toBe(true);
      expect(result.findings.length).toBe(0);

      const nestedFindings = result.findings.filter(
        (f) => f.token === "nested_function_call",
      );
      expect(nestedFindings.length).toBe(0);

      const compFindings = result.findings.filter(
        (f) => f.token === "composition_operator",
      );
      expect(compFindings.length).toBe(0);
    });
  });

  describe("acceptance test 3: uncached skills are skipped, not false-positived", () => {
    it("skips uncached skills and lists them in uncached_skills", () => {
      rmSync(join(BATCH_DIR, "geometry.ndjson"), { force: true });

      const batchQuestions = [
        {
          id: "lyceon-uncached-001",
          skill: "Some Uncached Skill",
          skill_codes: ["Some Uncached Skill"],
          stem: "This skill has $f(g(x))$ composition but no cache.",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          correct_answer: "A",
          explanation: "test",
          section: "M",
          domain: "Test",
          difficulty: 1,
          item_type: "mcq",
        },
      ];
      writeFileSync(
        join(BATCH_DIR, "uncached.ndjson"),
        batchQuestions.map((q) => JSON.stringify(q)).join("\n") + "\n",
      );

      const result = runNotationAudit(BATCH_DIR);

      expect(result.pass).toBe(true);
      expect(result.uncached_skills).toContain("Some Uncached Skill");
      expect(result.findings.length).toBe(0);
    });
  });
});
