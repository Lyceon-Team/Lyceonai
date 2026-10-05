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
  examStudentReportPayloadSchema,
  examStudentReportScoredSchema,
  toStudentExamReport,
} from "../../packages/shared/src/exam-student-report-schema";
import { toGuardianExamReport } from "../../packages/shared/src/exam-guardian-report-schema";
import {
  ReportIntegrityError,
  resumeActionFor,
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

/** G1: what exam_domain_breakdown returns for a fully scored attempt. */
const RW_ROWS = [
  { section: "RW", domain: "Craft and Structure", correct: 10, total: 13 },
  { section: "RW", domain: "Expression of Ideas", correct: 6, total: 8 },
  { section: "RW", domain: "Information and Ideas", correct: 9, total: 12 },
  {
    section: "RW",
    domain: "Standard English Conventions",
    correct: 11,
    total: 21,
  },
] as const;
const BREAKDOWN = [
  ...RW_ROWS,
  { section: "M", domain: "Advanced Math", correct: 12, total: 15 },
  { section: "M", domain: "Algebra", correct: 11, total: 13 },
  { section: "M", domain: "Geometry and Trigonometry", correct: 4, total: 7 },
  {
    section: "M",
    domain: "Problem Solving and Data Analysis",
    correct: 5,
    total: 9,
  },
] as const;

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
    const p = serializeStudentReport(s, reportStateOf(s, true), BREAKDOWN);
    expect(p.report_state).toBe("scored");
    if (p.report_state !== "scored") return;
    expect(p.score.total_scaled).toBe(1340);
    expect(p.disclosure).toEqual(DISCLOSURE);
    expect(p.review_unlocked).toBe(true);
  });

  it("a scaled score never ships without its disclosure row (§15.1, §16.7)", () => {
    const s = source({ disclosure: null });
    expect(() => serializeStudentReport(s, "scored", BREAKDOWN)).toThrow(
      ReportIntegrityError,
    );
  });

  it("G1: the breakdown ships with the score, one row per domain, correct-of-total", () => {
    const p = serializeStudentReport(source(), "scored", BREAKDOWN);
    if (p.report_state !== "scored") throw new Error("not scored");
    expect(p.domain_breakdown).toEqual(BREAKDOWN);
    expect(Object.keys(p.domain_breakdown[0]!).sort()).toEqual([
      "correct",
      "domain",
      "section",
      "total",
    ]);
  });

  it("G1: a breakdown that does not cover exactly the scored sections is an integrity violation", () => {
    expect(() => serializeStudentReport(source(), "scored", RW_ROWS)).toThrow(
      ReportIntegrityError,
    );
    expect(() => serializeStudentReport(source(), "scored", [])).toThrow(
      ReportIntegrityError,
    );
  });

  it("G1: a breakdown row with a skill, a module or a mismatched domain fails the strict parse", () => {
    const p = serializeStudentReport(source(), "scored", BREAKDOWN);
    const row = BREAKDOWN[0];
    for (const bad of [
      { ...row, skill_code: "CAS.WIC" },
      { ...row, module: "2A" },
      { ...row, domain: "Algebra" }, // a Math domain on an RW row
      { ...row, correct: 14, total: 13 },
    ]) {
      expect(() =>
        examReportScoredSchema.parse({ ...p, domain_breakdown: [bad] }),
      ).toThrow();
    }
  });

  it("a scored payload with a decomposition field fails the strict parse (§11.7)", () => {
    const s = source();
    const p = serializeStudentReport(s, "scored", BREAKDOWN);
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
    const p = serializeStudentReport(s, reportStateOf(s, true), RW_ROWS);
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
    // G1: only the scored section is broken down.
    expect(new Set(p.domain_breakdown.map((r) => r.section))).toEqual(
      new Set(["RW"]),
    );
  });

  it("pending: no score, no disclosure block (§15.4)", () => {
    const s = source({ score_run: null, disclosure: null });
    const p = serializeStudentReport(s, reportStateOf(s, true), []);
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
    const p = serializeStudentReport(s, reportStateOf(s, true), []);
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
    const p = serializeStudentReport(s, reportStateOf(s, false), []);
    expect(p.report_state).toBe("unavailable");
    expect(JSON.stringify(p)).not.toMatch(/scaled|1340|disclosure/);
  });

  // @spec [Doc-04C_V1.0 §11.5b, §12.1b step 3] | owner ruling OQ-34 (2026-10-02)
  // | @implemented [2026-10-03] | plain English: the lapsed report carries the renewal
  // action, through the real serializer AND the real student projection the route sends.
  it("revoked access (entitlement_lapsed): the payload carries renew_entitlement (OQ-34)", () => {
    const s = source();
    const p = serializeStudentReport(s, reportStateOf(s, false), []);
    expect(p).toEqual({
      report_state: "unavailable",
      session_id: s.session.session_id,
      test_form_id: s.session.test_form_id,
      test_form_name: s.session.test_form_name,
      unavailable_reason: "entitlement_lapsed",
      unavailable_at: null,
      resume_action: { type: "renew_entitlement", url: null },
      review_unlocked: false,
    });
    const wire = examStudentReportPayloadSchema.parse(toStudentExamReport(p));
    expect(wire).toMatchObject({
      report_state: "unavailable",
      resume_action: { type: "renew_entitlement", url: null },
    });
  });

  it("resume_action by reason: only entitlement_lapsed is wired (§11.5b null otherwise)", () => {
    expect(resumeActionFor("entitlement_lapsed")).toEqual({
      type: "renew_entitlement",
      url: null,
    });
    expect(resumeActionFor("content_takedown")).toBeNull();
    expect(resumeActionFor("guardian_link_inactive")).toBeNull();
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
    expect(serializeStudentReport(live, "not_completed", [])).toMatchObject({
      resumable: true,
    });
    expect(serializeStudentReport(late, "not_completed", [])).toMatchObject({
      resumable: false,
    });
  });
});

/** Every key name at any depth of a JSON value. */
function keysDeep(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysDeep(v, acc);
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      keysDeep(v, acc);
    }
  }
  return acc;
}

/**
 * @spec [Doc-04C §8.1/§9.1; SCL-180 (amended 2026-09-29), owner ruling 7]
 *   | @implemented [2026-09-29]
 * plain English: the student's wire payload is `toStudentExamReport` of the REAL
 * serializer's output: seven segments per domain, never correct/total. The guardian's
 * projection of the same server-side report still carries correct/total (SCL-180).
 */
describe("owner ruling 7: the student report carries segments, never counts", () => {
  const partialSource = () =>
    source({
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

  it("scored: eight segment rows present (asserted first), then no correct/total/domain_breakdown at any depth", () => {
    const p = toStudentExamReport(
      serializeStudentReport(source(), "scored", BREAKDOWN),
    );
    if (p.report_state !== "scored") throw new Error(p.report_state);
    // presence before absence
    expect(p.domain_segments).toHaveLength(8);
    expect(
      p.domain_segments.every((r) => Number.isInteger(r.segments_filled)),
    ).toBe(true);
    expect(p.domain_segments.find((r) => r.domain === "Algebra")).toEqual({
      section: "M",
      domain: "Algebra",
      segments_filled: 6, // 11 of 13 -> 77/13 = 5.92 -> 6
    });
    expect(p.omitted_domains).toEqual([]);
    for (const row of p.domain_segments) {
      expect(row).not.toHaveProperty("correct");
      expect(row).not.toHaveProperty("total");
    }
    const keys = keysDeep(p);
    expect(keys.has("segments_filled")).toBe(true);
    expect(
      ["correct", "total", "domain_breakdown"].filter((k) => keys.has(k)),
    ).toEqual([]);
    examStudentReportPayloadSchema.parse(p);
  });

  it("partial: the scored section's segments, the unscored section's domains omitted with a reason", () => {
    const s = partialSource();
    const p = toStudentExamReport(
      serializeStudentReport(s, reportStateOf(s, true), RW_ROWS),
    );
    if (p.report_state !== "partial_scored") throw new Error(p.report_state);
    expect(p.domain_segments.map((r) => r.section)).toEqual([
      "RW",
      "RW",
      "RW",
      "RW",
    ]);
    expect(p.omitted_domains.map((o) => [o.section, o.reason])).toEqual([
      ["M", "section_not_scored"],
      ["M", "section_not_scored"],
      ["M", "section_not_scored"],
      ["M", "section_not_scored"],
    ]);
    const keys = keysDeep(p);
    expect(
      ["correct", "total", "domain_breakdown"].filter((k) => keys.has(k)),
    ).toEqual([]);
  });

  it("the strict student schema refuses a count smuggled onto a row or the payload", () => {
    const p = toStudentExamReport(
      serializeStudentReport(source(), "scored", BREAKDOWN),
    );
    if (p.report_state !== "scored") throw new Error(p.report_state);
    const row = p.domain_segments[0]!;
    expect(examStudentReportScoredSchema.safeParse(p).success).toBe(true);
    for (const bad of [
      { ...p, domain_segments: [{ ...row, correct: 10 }] },
      { ...p, domain_segments: [{ ...row, total: 13 }] },
      { ...p, domain_breakdown: BREAKDOWN },
    ]) {
      expect(examStudentReportScoredSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("states without a breakdown pass through unchanged", () => {
    const s = source({ score_run: null, disclosure: null });
    const internal = serializeStudentReport(s, reportStateOf(s, true), []);
    expect(toStudentExamReport(internal)).toEqual(internal);
  });

  it("guardian: the guardian projection of the same report is the student's segments, no counts (SCL-210)", () => {
    const internal = serializeStudentReport(source(), "scored", BREAKDOWN);
    const g = toGuardianExamReport(internal);
    if (g.report_state !== "scored") throw new Error(g.report_state);
    const byDomain = (a: { domain: string }, b: { domain: string }) =>
      a.domain.localeCompare(b.domain);
    // Expected segments computed here, not by the projection under test (G5-11, SCL-210):
    // the nearest of seven, half rounding up (SCL-180 ruling 7).
    expect([...g.domain_breakdown].sort(byDomain)).toEqual(
      BREAKDOWN.map((r) => ({
        section: r.section,
        domain: r.domain,
        segments_filled: Math.floor((14 * r.correct + r.total) / (2 * r.total)),
      })).sort(byDomain),
    );
    // And in the student's own order: the rows are the student's rows.
    const student = toStudentExamReport(internal);
    if (student.report_state !== "scored")
      throw new Error(student.report_state);
    expect(g.domain_breakdown).toEqual(student.domain_segments);
    expect(g).not.toHaveProperty("domain_segments");
    expect(g).not.toHaveProperty("omitted_domains");
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
    ["student report payloads", examStudentReportPayloadSchema],
    ["report status", examReportStatusSchema],
    ["forms list", examFormsResponseSchema],
  ] as const)("%s carry none of the forbidden fields", (_name, schema) => {
    const keys = keysOf(schema as unknown as ZodTypeAny);
    expect(keys.size).toBeGreaterThan(2);
    expect(FORBIDDEN.filter((k) => keys.has(k))).toEqual([]);
  });

  it("owner ruling 7: the student wire schema has segments_filled and no correct/total key anywhere", () => {
    const keys = keysOf(
      examStudentReportPayloadSchema as unknown as ZodTypeAny,
    );
    expect(keys.has("segments_filled")).toBe(true);
    expect(keys.has("omitted_domains")).toBe(true);
    expect(
      ["correct", "total", "domain_breakdown"].filter((k) => keys.has(k)),
    ).toEqual([]);
  });
});
