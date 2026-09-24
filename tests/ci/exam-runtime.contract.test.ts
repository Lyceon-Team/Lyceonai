/**
 * Full-length exam runtime — contract checks that need no database.
 *
 * @spec [Doc-04A_V2.2, §10.2 (pre-completion payload), §16 (surface; no admin
 *        endpoint in this layer); Coding Standards §5.2; E6 SCL-133 (shared token
 *        resolution)]
 * @implemented [2026-09-24]
 *
 * plain English: runs in the plain `ci` job. Pins (1) the question payload schema:
 * correct_answer / explanation are null and nothing else answer-bearing can ride
 * along; (2) the serializer's output shape; (3) the one token -> canonical-letter
 * rule practice, review and the exam share; (4) the router's surface: exactly the
 * seven 04A §16 student endpoints, nothing under /admin.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in the contract test");
    },
    from: () => {
      throw new Error("no database in the contract test");
    },
  },
}));

import { examQuestionPayloadSchema } from "../../packages/shared/src/exam-runtime-schema";
import { resolveSelectedCanonicalKey } from "../../shared/question-bank-contract";
import { toExamQuestionPayload } from "../../server/services/exam-runtime-service";
import examRuntimeRouter from "../../server/routes/exam-runtime-routes";

const BASE = {
  question_id: "SATM2ABC123",
  ordinal: 3,
  question_type: "multiple_choice" as const,
  stem: "What is x?",
  passage: null,
  options: [{ id: "opt_0123456789abcdef", text: "4" }],
  assets: null,
  current_answer: null,
  correct_answer: null,
  explanation: null,
};

describe("exam question payload (Doc 04A §10.2)", () => {
  it("accepts the exact pre-submit shape", () => {
    expect(examQuestionPayloadSchema.safeParse(BASE).success).toBe(true);
  });

  it.each([
    ["correct_answer carries a value", { ...BASE, correct_answer: "A" }],
    ["explanation carries a value", { ...BASE, explanation: "because" }],
    ["domain rides along", { ...BASE, domain: "Algebra" }],
    ["difficulty rides along", { ...BASE, difficulty: 2 }],
    ["skill_code rides along", { ...BASE, skill_code: "ALG.1" }],
    ["correct_variants rides along", { ...BASE, correct_variants: ["4"] }],
    [
      "an option carries its canonical key",
      { ...BASE, options: [{ id: "opt_x", text: "4", key: "B" }] },
    ],
  ])("rejects a payload where %s", (_label, payload) => {
    expect(examQuestionPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("the serializer emits exactly the schema's keys, answer fields null", () => {
    const out = toExamQuestionPayload(
      {
        ordinal: 0,
        question_id: "SATRW2XYZ789",
        item_type: "grid_in",
        stem: "Enter x.",
        passage: "A passage.",
        assets: { v: 1, items: [{ role: "explanation", kind: "svg" }] },
      },
      [],
      "42",
    );
    expect(Object.keys(out).sort()).toEqual(Object.keys(BASE).sort());
    expect(out.correct_answer).toBeNull();
    expect(out.explanation).toBeNull();
    expect(out.question_type).toBe("student_produced_response");
    // a post-submit-only asset role is dropped by practice's fail-closed filter
    expect(out.assets).toBeNull();
  });
});

describe("resolveSelectedCanonicalKey (practice, review and exam share it)", () => {
  const map = { opt_aaaa: "C", opt_bbbb: "A" };
  it("resolves a served token to its canonical key", () => {
    expect(resolveSelectedCanonicalKey("opt_aaaa", map)).toBe("C");
    expect(resolveSelectedCanonicalKey("opt_bbbb", map)).toBe("A");
  });
  it("reads a non-token as a canonical letter (practice's fallback)", () => {
    expect(resolveSelectedCanonicalKey("d", map)).toBe("D");
  });
  it("returns null for anything else", () => {
    expect(resolveSelectedCanonicalKey("opt_zzzz", map)).toBeNull();
    expect(resolveSelectedCanonicalKey("", map)).toBeNull();
  });
});

describe("router surface (Doc 04A §16; no admin surface in E6)", () => {
  it("mounts exactly the seven student endpoints", () => {
    const routes = (
      examRuntimeRouter as unknown as {
        stack: Array<{
          route?: { path: string; methods: Record<string, boolean> };
        }>;
      }
    ).stack
      .filter((layer) => layer.route)
      .map(
        (layer) =>
          `${Object.keys(layer.route!.methods)[0]!.toUpperCase()} ${layer.route!.path}`,
      )
      .sort();
    expect(routes).toEqual(
      [
        "POST /sessions",
        "GET /sessions/:session_id/state",
        "POST /sessions/:session_id/sections/:section/modules/:module/start",
        "GET /sessions/:session_id/sections/:section/modules/:module/items",
        "POST /answer",
        "POST /sessions/:session_id/sections/:section/modules/:module/submit",
        "POST /sessions/:session_id/sections/:section/heartbeat",
      ].sort(),
    );
    expect(routes.join(" ")).not.toMatch(/admin|publish|outbox|report/);
  });
});
