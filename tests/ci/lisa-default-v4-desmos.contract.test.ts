/**
 * lisa-default-v4: the Desmos block, its gating, and the fields that drive the gating.
 *
 * @spec [docs/lisa/desmos-playbook.md §8, §9; Karl's rulings 2026-10-27: the block goes in when
 *       questions.section = 'M' (passed from the BFF, never inferred from mastery), and in
 *       general mode when the current message matches the `desmos` method in
 *       video_method_keywords; nowhere else] | @implemented [2026-10-27]
 *
 * plain English:
 *   D1 the block in the artifact is the playbook's §9 block, verbatim.
 *   D2 the gating matrix: in on a math item and on a general-mode Desmos request; out
 *      everywhere else, including an unread section and a Desmos request on a Reading and
 *      Writing item.
 *   D3 v4 without the block is v3, byte for byte; with it, v3 then the block.
 *   D4 production stays on v3: v4 resolves by exact version only.
 *   D5 the worker's own buildSystemInstruction carries the block for a math item and not for
 *      a Reading and Writing one, from the wire fields.
 *   D6 the wire accepts the new fields and an older envelope without them.
 *   D7 the BFF's resolveQuestionContent reads the section from the question row, and any doubt
 *      is null.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";

const db = { current: new FakeTutorDb() };
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  DESMOS_BLOCK,
  LISA_DEFAULT_V4,
  desmosBlockApplies,
} from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v4";
import { LISA_DEFAULT_V3 } from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v3";
import { resolvePromptArtifact } from "../../apps/workers/tutor-orchestrator/src/prompts/prompt-registry";
import type { PromptFields } from "../../apps/workers/tutor-orchestrator/src/prompts/types";
import { buildSystemInstruction } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { orchestrateRequestSchema } from "../../shared/tutor-orchestrator-wire";
import { resolveQuestionContent } from "../../server/services/tutor-context";
import { buildGoldenEnvelope } from "./lisa-golden-set-helpers";

function fields(over: Partial<PromptFields>): PromptFields {
  return {
    entryMode: "scoped_question",
    sourceSurface: "practice",
    policyVariant: "default",
    isPostSubmit: false,
    questionSection: null,
    requestedMethod: null,
    ...over,
  };
}

function mathEnvelope(section: "M" | "RW" | null) {
  const base = buildGoldenEnvelope({
    surface: "practice",
    isPostSubmit: false,
    question: {
      stem: "If 2x + 3 = 7, what is x?",
      options: [{ key: "A", text: "2" }],
    },
    correctAnswer: "A",
    messages: [{ role: "student", text: "can i use desmos" }],
  });
  if (base.question_content === null)
    throw new Error("fixture has no question");
  return {
    ...base,
    policy_assignment: {
      ...base.policy_assignment,
      prompt_version: "lisa-default-v4",
    },
    question_content: { ...base.question_content, section },
  };
}

describe("lisa-default-v4 Desmos block", () => {
  it("D1 the artifact's block is the playbook §9 block, verbatim", () => {
    const doc = readFileSync("docs/lisa/desmos-playbook.md", "utf8");
    const section = doc.slice(doc.indexOf("## 9."));
    const fenced = /```text\n([\s\S]*?)\n```/.exec(section);
    expect(fenced?.[1]).toBe(DESMOS_BLOCK);
    expect(DESMOS_BLOCK.startsWith("DESMOS (math only).")).toBe(true);
    // Karl, 2026-10-27: the first Desmos step ends with this exact phrase.
    expect(DESMOS_BLOCK).toContain(
      'end that step with "Tell me if you get stuck."',
    );
  });

  it("D2 gating: math item, or a general-mode Desmos request; nowhere else", () => {
    expect(desmosBlockApplies(fields({ questionSection: "M" }))).toBe(true);
    expect(
      desmosBlockApplies(
        fields({ entryMode: "general", requestedMethod: "desmos" }),
      ),
    ).toBe(true);
    expect(desmosBlockApplies(fields({ questionSection: "RW" }))).toBe(false);
    expect(desmosBlockApplies(fields({ questionSection: null }))).toBe(false);
    expect(
      desmosBlockApplies(
        fields({ questionSection: "RW", requestedMethod: "desmos" }),
      ),
    ).toBe(false);
    expect(desmosBlockApplies(fields({ requestedMethod: "desmos" }))).toBe(
      false,
    );
    expect(
      desmosBlockApplies(
        fields({ entryMode: "general", requestedMethod: "algebraic" }),
      ),
    ).toBe(false);
    expect(desmosBlockApplies(fields({ entryMode: "general" }))).toBe(false);
    expect(
      desmosBlockApplies(
        fields({ entryMode: "scoped_session", requestedMethod: "desmos" }),
      ),
    ).toBe(false);
  });

  it("D3 without the block v4 is v3 byte for byte; with it, v3 then the block", () => {
    const off = fields({ questionSection: "RW" });
    expect(LISA_DEFAULT_V4.renderSystemInstruction(off)).toBe(
      LISA_DEFAULT_V3.renderSystemInstruction(off),
    );
    const on = fields({ questionSection: "M" });
    expect(LISA_DEFAULT_V4.renderSystemInstruction(on)).toBe(
      `${LISA_DEFAULT_V3.renderSystemInstruction(on)}\n\n${DESMOS_BLOCK}`,
    );
  });

  it("D4 production stays on v3; v4 resolves by exact version only", () => {
    for (const variant of [
      "default",
      "scaffolded",
      "socratic",
      "concise",
      "strategy_first",
    ]) {
      expect(resolvePromptArtifact(variant, null).version).toBe(
        "lisa-default-v3",
      );
    }
    expect(resolvePromptArtifact("scaffolded", "lisa-default-v4").version).toBe(
      "lisa-default-v4",
    );
  });

  it("D5 the worker's system instruction carries the block for M and not for RW", () => {
    const math = buildSystemInstruction(
      orchestrateRequestSchema.parse(mathEnvelope("M")),
    );
    const rw = buildSystemInstruction(
      orchestrateRequestSchema.parse(mathEnvelope("RW")),
    );
    const unread = buildSystemInstruction(
      orchestrateRequestSchema.parse(mathEnvelope(null)),
    );
    expect(math).toContain(DESMOS_BLOCK);
    expect(rw).not.toContain("DESMOS (math only)");
    expect(unread).not.toContain("DESMOS (math only)");
  });

  it("D6 the wire takes the new fields, and an envelope without them still parses", () => {
    const withFields = { ...mathEnvelope("M"), requested_method: "desmos" };
    const parsed = orchestrateRequestSchema.parse(withFields);
    expect(parsed.question_content?.section).toBe("M");
    expect(parsed.requested_method).toBe("desmos");
    const old = buildGoldenEnvelope({
      surface: "dashboard",
      isPostSubmit: false,
      question: null,
      correctAnswer: null,
    });
    const parsedOld = orchestrateRequestSchema.parse(old);
    expect(parsedOld.requested_method).toBeUndefined();
    expect(() =>
      orchestrateRequestSchema.parse({
        ...old,
        requested_method: "calculator",
      }),
    ).toThrow();
  });
});

describe("D7 the BFF reads questions.section", () => {
  const STUDENT_ID = "55555555-5555-4555-8555-555555555555";

  beforeEach(() => {
    db.current = new FakeTutorDb();
  });

  function seedItem(): string {
    return db.current.seed("practice_session_items", {
      user_id: STUDENT_ID,
      status: "served",
      question_stem: "If 2x + 3 = 7, what is x?",
      question_passage: null,
      question_options: [
        { key: "A", text: "1" },
        { key: "B", text: "2" },
      ],
      question_item_type: "mcq",
      selected_answer: null,
      ordinal: 1,
    }).id as string;
  }

  function scope(itemId: string, questionRowId: string | null) {
    return {
      source_session_id: null,
      source_session_item_id: itemId,
      source_question_row_id: questionRowId,
      source_question_canonical_id: null,
    } as Parameters<typeof resolveQuestionContent>[1];
  }

  it("a math row gives M, a reading row RW", async () => {
    const m = db.current.seed("questions", { section: "M" }).id as string;
    const rw = db.current.seed("questions", { section: "RW" }).id as string;
    const qcM = await resolveQuestionContent(
      STUDENT_ID,
      scope(seedItem(), m),
      false,
    );
    const qcRW = await resolveQuestionContent(
      STUDENT_ID,
      scope(seedItem(), rw),
      false,
    );
    expect(qcM?.stem).toBe("If 2x + 3 = 7, what is x?");
    expect(qcM?.section).toBe("M");
    expect(qcRW?.section).toBe("RW");
  });

  it("no row id, a missing row, or an unexpected value is null", async () => {
    const odd = db.current.seed("questions", { section: "SCIENCE" })
      .id as string;
    for (const rowId of [null, "00000000-0000-4000-8000-00000000dead", odd]) {
      const qc = await resolveQuestionContent(
        STUDENT_ID,
        scope(seedItem(), rowId),
        false,
      );
      expect(qc).not.toBeNull();
      expect(qc?.section).toBeNull();
    }
  });
});
