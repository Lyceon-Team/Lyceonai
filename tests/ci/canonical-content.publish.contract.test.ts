import { describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { publishQuestion, versionPublishedQuestion } from "../../server/services/question-publish";

type AnyRecord = Record<string, any>;
const repoRoot = path.resolve(__dirname, "..", "..");

function buildValidOptions() {
  return [
    { key: "A", text: "Option A" },
    { key: "B", text: "Option B" },
    { key: "C", text: "Option C" },
    { key: "D", text: "Option D" },
  ];
}

function readServerIndex(): string {
  return fs.readFileSync(path.join(repoRoot, "server", "index.ts"), "utf8");
}

function createMockSupabase(initialQuestion: AnyRecord, canonicalTaken = false) {
  let question = { ...initialQuestion };
  const versionRows: AnyRecord[] = [];

  const supabase = {
    from(table: string) {
      if (table === "questions") {
        const filters: AnyRecord = {};
        let patch: AnyRecord | null = null;

        return {
          select() {
            return this;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return this;
          },
          maybeSingle: async () => {
            if (filters.canonical_id) {
              if (canonicalTaken) {
                return { data: { id: "other-question-id" }, error: null };
              }
              return { data: null, error: null };
            }
            return { data: null, error: null };
          },
          update(nextPatch: AnyRecord) {
            patch = nextPatch;
            return this;
          },
          single: async () => {
            if (filters.id && String(filters.id) !== String(question.id)) {
              return { data: null, error: { message: "not found" } };
            }

            if (patch) {
              question = { ...question, ...patch };
            }

            return { data: { ...question }, error: null };
          },
        };
      }

      if (table === "question_versions") {
        return {
          insert: async (payload: AnyRecord) => {
            versionRows.push(payload);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    supabase,
    getQuestion: () => ({ ...question }),
    getVersionRows: () => [...versionRows],
  };
}

describe("Canonical Content Publish Contract", () => {
  it("blocks publish when canonical_id is already owned by another question", async () => {
    const mock = createMockSupabase(
      {
        id: "question-1",
        status: "qa",
        version: 1,
        canonical_id: "SATM1ABC123",
        section: "Math",
        section_code: "M",
        source_type: 1,
        question_type: "multiple_choice",
        stem: "What is 2 + 2?",
        options: buildValidOptions(),
        correct_answer: "A",
      },
      true
    );

    await expect(
      publishQuestion({
        questionId: "question-1",
        supabase: mock.supabase,
      })
    ).rejects.toThrow("publish_duplicate_canonical_id");

    expect(mock.getVersionRows()).toHaveLength(0);
  });

  it("blocks publish when options payload is not canonical MC4", async () => {
    const mock = createMockSupabase({
      id: "question-2",
      status: "qa",
      version: 1,
      canonical_id: null,
      section: "Math",
      section_code: "M",
      source_type: 1,
      question_type: "multiple_choice",
      stem: "Invalid options question",
      options: [
        { key: "A", text: "A" },
        { key: "B", text: "B" },
        { key: "C", text: "C" },
      ],
      correct_answer: "A",
    });

    await expect(
      publishQuestion({
        questionId: "question-2",
        supabase: mock.supabase,
      })
    ).rejects.toThrow("publish_validation_failed");

    expect(mock.getVersionRows()).toHaveLength(0);
  });

  it("publishes via service and writes canonical published version snapshot", async () => {
    const mock = createMockSupabase({
      id: "question-publish-1",
      status: "qa",
      version: 1,
      canonical_id: null,
      section: "Math",
      section_code: "M",
      source_type: 1,
      question_type: "multiple_choice",
      stem: "What is 3 + 2?",
      options: buildValidOptions(),
      correct_answer: "C",
    });

    const result = await publishQuestion({
      questionId: "question-publish-1",
      supabase: mock.supabase,
    });

    expect(result.status).toBe("published");
    expect(result.canonicalId).toMatch(/^SAT(?:M|RW)[12][A-Z0-9]{6}$/);
    expect(mock.getQuestion().status).toBe("published");
    expect(mock.getQuestion().canonical_id).toBe(result.canonicalId);
    expect(mock.getVersionRows()).toHaveLength(1);
    expect(mock.getVersionRows()[0].lifecycle_status).toBe("published");
  });
  it("requires published edits to be versioned and moves lifecycle back to qa", async () => {
    const mock = createMockSupabase({
      id: "question-3",
      status: "published",
      version: 1,
      canonical_id: "SATM1ABC123",
      section: "Math",
      section_code: "M",
      source_type: 1,
      question_type: "multiple_choice",
      stem: "Original stem",
      options: buildValidOptions(),
      correct_answer: "A",
      explanation: "Original explanation",
    });

    const result = await versionPublishedQuestion({
      questionId: "question-3",
      patch: {
        stem: "Updated stem",
        explanation: "Updated explanation",
      },
      supabase: mock.supabase,
    });

    expect(result).toMatchObject({
      questionId: "question-3",
      canonicalId: "SATM1ABC123",
      status: "qa",
      version: 2,
    });

    expect(mock.getQuestion().status).toBe("qa");
    expect(mock.getQuestion().version).toBe(2);
    expect(mock.getQuestion().canonical_id).toBe("SATM1ABC123");
    expect(mock.getVersionRows()).toHaveLength(1);
    expect(mock.getVersionRows()[0].lifecycle_status).toBe("qa");
  });

  it("blocks canonical_id mutation during versioning", async () => {
    const mock = createMockSupabase({
      id: "question-4",
      status: "published",
      version: 1,
      canonical_id: "SATRW2ABC123",
      section: "RW",
      section_code: "RW",
      source_type: 2,
      question_type: "multiple_choice",
      stem: "Immutable ID question",
      options: buildValidOptions(),
      correct_answer: "B",
    });

    await expect(
      versionPublishedQuestion({
        questionId: "question-4",
        patch: { canonical_id: "SATM1ZZZ999" } as any,
        supabase: mock.supabase,
      })
    ).rejects.toThrow("version_blocked_canonical_id_immutable");
  });

  it("keeps /api/questions/validate unmounted in runtime", async () => {
    const appModule = await import("../../server/index");
    const app = appModule.default;

    const res = await request(app)
      .post("/api/questions/validate")
      .send({ questionId: "q-1", studentAnswer: "A" });

    expect(res.status).toBe(404);
  });

  it("keeps /api/review-errors/attempt mounted to session-based owner (not legacy review-errors route)", async () => {
    const indexContent = readServerIndex();

    expect(indexContent).toContain('from "./routes/review-session-routes"');
    expect(indexContent).toContain("submitReviewSessionAnswer");
    expect(indexContent).toContain('app.post("/api/review-errors/attempt", requireSupabaseAuth, requireStudentOrAdmin, csrfProtection, submitReviewSessionAnswer);');
    expect(indexContent).not.toContain("recordReviewErrorAttempt");
    expect(indexContent).not.toContain("./routes/review-errors-routes");

    const appModule = await import("../../server/index");
    const app = appModule.default;
    const res = await request(app).post("/api/review-errors/attempt").send({});

    expect(res.status).not.toBe(404);
  });

  it("keeps /api/admin/questions/* unmounted in runtime", async () => {
    const appModule = await import("../../server/index");
    const app = appModule.default;

    const needsReview = await request(app).get("/api/admin/questions/needs-review");
    const approve = await request(app).post("/api/admin/questions/123/approve").send({});

    expect(needsReview.status).toBe(404);
    expect(approve.status).toBe(404);
  });
});

