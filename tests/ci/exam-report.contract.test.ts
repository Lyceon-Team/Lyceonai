/**
 * Full-length exam score report (Doc 04C) — contract checks that need no database.
 *
 * @spec [Doc-04C_V1.0, §5.3 (derivation), §8.1/§9.1/§10.2/§11.4/§11.5/§11.5b
 *        (payloads), §9.3 (no total framing), §10.3 (no failure internals), §11.3
 *        (strict serializers), §11.7 (field-level redaction linter), §15.1
 *        (disclosure from the payload), §16.7 (integrity violation)]
 * @implemented [2026-09-25]
 *
 * plain English: runs in the plain `ci` job. Pins the one derivation (every
 * branch), each per-state serializer's output, the §11.7 redaction list against
 * EVERY report schema (a recursive key scan — 04C's "field redaction linter"), and
 * that a score never serializes without its disclosure row.
 */
import { describe, it, expect, vi } from "vitest";
import type { ZodTypeAny } from "zod";

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in the contract test");
    },
  },
}));

import {
  deriveReportState,
  examReportPayloadSchema,
  examReportScoredSchema,
  examReportStatusSchema,
  examFormsResponseSchema,
} from "../../packages/shared/src/exam-report-schema";
import {
  ReportIntegrityError,
  serializeStudentReport,
  reportStateOf,
  type ExamReportSource,
} from "../../server/services/exam-report-service";

const DISCLOSURE = {
  disclosure_version: "disclosure-v1.0",
  summary:
    "Lyceon-modeled SAT score. Designed to approximate Digital SAT score ranges using Lyceon's internal scoring model. This is not an official College Board score prediction and may differ from official SAT scores by ±20-50 points or more.",
  full_text_url: "/legal/score-disclosure",
};

function source(over: Partial<ExamReportSource> = {}): ExamReportSource {
  return {
    session: {
      session_id: "00000000-0000-4000-8000-00000000e7a1",
      test_form_id: "00000000-0000-4000-8000-00000000e7f1",
      test_form_name: "Practice Test 1",
      state: "completed",
      mode: "strict",
      grace_expires_at: "2026-09-26T00:00:00Z",
      completed_at: "2026-09-25T12:00:00Z",
      abandoned_at: null,
      attempt_number_for_form: 1,
      is_first_seen_form_attempt: true,
    },
    server_now: "2026-09-25T12:00:01Z",
    sections: [
      { section: "RW", state: "submitted", module2_submitted_by: "student" },
      { section: "M", state: "submitted", module2_submitted_by: "student" },
    ],
    score_run: {
      score_run_id: "00000000-0000-4000-8000-00000000e7b1",
      rw_scored: true,
      math_scored: true,
      rw_scaled: 690,
      math_scaled: 650,
      total_scaled: 1340,
      partial_display_scaled: null,
      scoring_model_version: "v1.0",
      scored_at: "2026-09-25T12:00:00Z",
    },
    failure: null,
    disclosure: DISCLOSURE,
    ...over,
  };
}

describe("§5.3 derivation — every branch", () => {
  const base = {
    scoreTotalPresent: false,
    scorePartialPresent: false,
    failurePresent: false,
    accessGranted: true,
  };
  it.each([
    ["created", {}, "not_completed"],
    ["active", {}, "not_completed"],
    ["section_break", {}, "not_completed"],
    ["abandoned_final", {}, "not_completed"],
    ["completed", {}, "scoring_pending"],
    ["completed", { scoreTotalPresent: true }, "scored"],
    ["completed", { failurePresent: true }, "failed_requires_review"],
    ["completed", { scoreTotalPresent: true, failurePresent: true }, "scored"],
    ["partial_scored_abandoned", {}, "scoring_pending"],
    [
      "partial_scored_abandoned",
      { scorePartialPresent: true },
      "partial_scored",
    ],
    [
      "partial_scored_abandoned",
      { failurePresent: true },
      "failed_requires_review",
    ],
    [
      "completed",
      { scoreTotalPresent: true, accessGranted: false },
      "unavailable",
    ],
  ] as const)("%s %j -> %s", (sessionState, over, want) => {
    expect(deriveReportState({ ...base, sessionState, ...over })).toBe(want);
  });
});

describe("per-state serializers (§11.3)", () => {
  it("scored carries the disclosure row verbatim and both sections", () => {
    const s = source();
    const p = serializeStudentReport(s, reportStateOf(s, true));
    expect(p.report_state).toBe("scored");
    if (p.report_state !== "scored") return;
    expect(p.score.total_scaled).toBe(1340);
    expect(p.disclosure).toEqual(DISCLOSURE);
    expect(p.review_unlocked).toBe(true);
  });

  it("a scaled score never ships without its disclosure row (§15.1, §16.7)", () => {
    const s = source({ disclosure: null });
    expect(() => serializeStudentReport(s, "scored")).toThrow(
      ReportIntegrityError,
    );
  });

  it("a scored payload with a decomposition field fails the strict parse (§11.7)", () => {
    const s = source();
    const p = serializeStudentReport(s, "scored");
    expect(() =>
      examReportScoredSchema.parse({
        ...p,
        score: { ...(p as { score: object }).score, rw_module1_correct: 20 },
      }),
    ).toThrow();
  });

  it("partial: no total, the incomplete section named, no total framing (§9.3)", () => {
    const s = source({
      session: {
        ...source().session,
        state: "partial_scored_abandoned",
        completed_at: null,
        abandoned_at: "2026-09-25T13:00:00Z",
      },
      sections: [
        { section: "RW", state: "submitted", module2_submitted_by: "timeout" },
        {
          section: "M",
          state: "module1_submitted",
          module2_submitted_by: null,
        },
      ],
      score_run: {
        ...source().score_run!,
        math_scored: false,
        math_scaled: null,
        total_scaled: null,
        partial_display_scaled: 690,
      },
    });
    const p = serializeStudentReport(s, reportStateOf(s, true));
    expect(p.report_state).toBe("partial_scored");
    if (p.report_state !== "partial_scored") return;
    expect(p.score.total_scaled).toBeNull();
    expect(p.score.math_scaled).toBeNull();
    expect(p.completed_sections).toEqual(["RW"]);
    expect(p.incomplete_sections).toEqual(["M"]);
    expect(p.sections.map((x) => x.incompleteness_reason)).toEqual([
      null,
      "module1_only",
    ]);
    expect(p.partial_disclosure.summary).toBe(
      "Reading and Writing section score: 690. Math was not completed, so no total score is available.",
    );
    expect(p.partial_disclosure.summary).not.toMatch(
      /total score is \d|estimated|projected/i,
    );
  });

  it("pending: no score, no disclosure block (§15.4)", () => {
    const s = source({ score_run: null, disclosure: null });
    const p = serializeStudentReport(s, reportStateOf(s, true));
    expect(p.report_state).toBe("scoring_pending");
    expect(p).not.toHaveProperty("score");
    expect(p).not.toHaveProperty("disclosure");
  });

  it("failed: generic copy + INC reference, no internals (§10.3, §10.4)", () => {
    const s = source({
      score_run: null,
      disclosure: null,
      failure: {
        outbox_id: "a1b2c3d4-0000-4000-8000-000000000000",
        recorded_at: "2026-09-25T12:05:00Z",
      },
    });
    const p = serializeStudentReport(s, reportStateOf(s, true));
    expect(p.report_state).toBe("failed_requires_review");
    if (p.report_state !== "failed_requires_review") return;
    expect(p.failure_summary.incident_reference).toBe("INC-a1b2c3d4");
    expect(p.failure_summary.student_facing_message).toContain(
      "(Reference: INC-a1b2c3d4)",
    );
    expect(JSON.stringify(p)).not.toMatch(
      /failure_code|severity|outbox|sqlstate|v1\.0/i,
    );
    expect(p.review_unlocked).toBe(false);
  });

  it("revoked access: 200 unavailable with no score (§11.5b)", () => {
    const s = source();
    const p = serializeStudentReport(s, reportStateOf(s, false));
    expect(p.report_state).toBe("unavailable");
    expect(JSON.stringify(p)).not.toMatch(/scaled|1340|disclosure/);
  });

  it("not_completed: resumable only before grace", () => {
    const live = source({
      session: { ...source().session, state: "active", completed_at: null },
    });
    const late = source({
      session: {
        ...source().session,
        state: "active",
        completed_at: null,
        grace_expires_at: "2026-09-25T00:00:00Z",
      },
    });
    expect(serializeStudentReport(live, "not_completed")).toMatchObject({
      resumable: true,
    });
    expect(serializeStudentReport(late, "not_completed")).toMatchObject({
      resumable: false,
    });
  });
});

/** Every key reachable in a Zod schema (objects, arrays, unions, nullables). */
function keysOf(schema: ZodTypeAny, acc = new Set<string>()): Set<string> {
  const def = schema._def as { typeName: string } & Record<string, unknown>;
  switch (def.typeName) {
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> })
        .shape;
      for (const [k, v] of Object.entries(shape)) {
        acc.add(k);
        keysOf(v, acc);
      }
      break;
    }
    case "ZodArray":
      keysOf(def.type as ZodTypeAny, acc);
      break;
    case "ZodNullable":
    case "ZodOptional":
      keysOf(def.innerType as ZodTypeAny, acc);
      break;
    case "ZodEffects":
      keysOf(def.schema as ZodTypeAny, acc);
      break;
    case "ZodDiscriminatedUnion":
    case "ZodUnion":
      for (const o of def.options as ZodTypeAny[]) keysOf(o, acc);
      break;
  }
  return acc;
}

describe("§11.7 field-level redaction linter", () => {
  const FORBIDDEN = [
    "module2_path",
    "rw_module2_path",
    "math_module2_path",
    "routing_threshold_rw",
    "routing_threshold_m",
    "routing_override_reason",
    "rw_module1_correct",
    "rw_module2_correct",
    "math_module1_correct",
    "rw_m2_easy_wrong",
    "rw_ceiling",
    "rw_s_raw",
    "source_outbox_event_id",
    "failure_code",
    "failure_severity",
    "failure_status",
    "failure_message",
    "internal",
    "score_table_version",
    "correct_answer",
    "explanation",
    "student_id",
    "actor_id",
  ];
  it.each([
    ["report payloads", examReportPayloadSchema],
    ["report status", examReportStatusSchema],
    ["forms list", examFormsResponseSchema],
  ] as const)("%s carry none of the forbidden fields", (_name, schema) => {
    const keys = keysOf(schema as unknown as ZodTypeAny);
    expect(keys.size).toBeGreaterThan(2);
    expect(FORBIDDEN.filter((k) => keys.has(k))).toEqual([]);
  });
});
