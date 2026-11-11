/**
 * @spec [Doc-03A_V3.0 §5.4 recent_friction, §10.2 chat_compaction; Doc-03D_V1.2 §10.3 (memory is
 *       data); closure plan W4-15, W4-16; owner brief 2026-11-08 ("W4-16 changes what LISA
 *       sees, so it ships as part of the line being evaluated, not as a separate default")]
 *       | @implemented [2026-11-08]
 *
 * plain English:
 *   F1 friction reads the turn's CONVERSATION. A self-deprecating student message in the
 *      conversation sets the signal, though the scope's practice session id is different (the bug
 *      compared the two, so the signal was always false).
 *   F2 a long gap between the conversation's last two student messages sets long_pause.
 *   F3 the reads carry the ownership predicate: another student's message in the same
 *      conversation id is never read (INV-03-14).
 *   F4 `asOf` (the eval import's cut-off) bounds the reads: a message after it is never seen.
 *   M1 on the data-boundary line (v5) a chat_compaction row's real fields reach the system
 *      instruction inside a `memory.chat_compaction` data block.
 *   M2 v3 and v4 render exactly what they did before: nothing, for the same row. Production's v3
 *      does not change.
 *   M3 a row that does not match the compaction schema keeps the old text read on every line.
 */
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

import { resolveLearningContext } from "../../server/services/tutor-context";
import { buildSystemInstruction } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { compactionText } from "../../apps/workers/tutor-orchestrator/src/prompts/render-state-blocks";
import { buildGoldenEnvelope } from "./lisa-golden-set-helpers";

const STUDENT = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const CONVERSATION = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const SCOPE = {
  source_session_id: SESSION,
  source_session_item_id: null,
  source_question_row_id: null,
  source_question_canonical_id: null,
} as Parameters<typeof resolveLearningContext>[1];

function message(
  student: string,
  text: string,
  at: string,
): Record<string, unknown> {
  return {
    conversation_id: CONVERSATION,
    student_id: student,
    role: "student",
    message: text,
    created_at: at,
  };
}

beforeEach(() => {
  db.current = new FakeTutorDb();
});

describe("W4-15: friction reads the conversation", () => {
  it("F1 a self-deprecating message in the conversation sets the signal", async () => {
    db.current.seed(
      "tutor_messages",
      message(STUDENT, "ok", "2026-11-04T10:00:00Z"),
    );
    db.current.seed(
      "tutor_messages",
      message(STUDENT, "i'm so stupid at this", "2026-11-04T10:00:30Z"),
    );
    const before = await resolveLearningContext(STUDENT, SCOPE);
    expect(before.recent_friction.self_deprecating_language_detected).toBe(
      false,
    );
    const after = await resolveLearningContext(STUDENT, SCOPE, {
      conversationId: CONVERSATION,
      asOf: null,
    });
    expect(after.recent_friction.self_deprecating_language_detected).toBe(true);
    expect(after.recent_friction.long_pause_detected).toBe(false);
  });

  it("F2 a long gap between the last two student messages sets long_pause", async () => {
    db.current.seed(
      "tutor_messages",
      message(STUDENT, "a", "2026-11-04T10:00:00Z"),
    );
    db.current.seed(
      "tutor_messages",
      message(STUDENT, "b", "2026-11-04T10:05:00Z"),
    );
    const ctx = await resolveLearningContext(STUDENT, SCOPE, {
      conversationId: CONVERSATION,
      asOf: null,
    });
    expect(ctx.recent_friction.long_pause_detected).toBe(true);
  });

  it("F3 another student's message in the same conversation id is never read", async () => {
    db.current.seed(
      "tutor_messages",
      message(OTHER, "i give up", "2026-11-04T10:00:00Z"),
    );
    db.current.seed(
      "tutor_messages",
      message(STUDENT, "fine", "2026-11-04T10:00:10Z"),
    );
    const ctx = await resolveLearningContext(STUDENT, SCOPE, {
      conversationId: CONVERSATION,
      asOf: null,
    });
    expect(ctx.recent_friction.self_deprecating_language_detected).toBe(false);
  });

  it("F4 asOf bounds the reads: a message after the cut-off is never seen", async () => {
    db.current.seed(
      "tutor_messages",
      message(STUDENT, "ok", "2026-11-04T10:00:00Z"),
    );
    db.current.seed(
      "tutor_messages",
      message(STUDENT, "next", "2026-11-04T10:00:20Z"),
    );
    db.current.seed(
      "tutor_messages",
      message(STUDENT, "i give up", "2026-11-04T10:09:00Z"),
    );
    const atCutoff = await resolveLearningContext(STUDENT, SCOPE, {
      conversationId: CONVERSATION,
      asOf: "2026-11-04T10:00:20Z",
    });
    expect(atCutoff.recent_friction.self_deprecating_language_detected).toBe(
      false,
    );
    expect(atCutoff.recent_friction.long_pause_detected).toBe(false);
    const now = await resolveLearningContext(STUDENT, SCOPE, {
      conversationId: CONVERSATION,
      asOf: null,
    });
    expect(now.recent_friction.self_deprecating_language_detected).toBe(true);
    expect(now.recent_friction.long_pause_detected).toBe(true);
  });
});

const COMPACTION = {
  summary_version: "1.0",
  conversation_id: CONVERSATION,
  source_window_start: "2026-11-03T10:00:00Z",
  source_window_end: "2026-11-03T10:20:00Z",
  turns_compacted: 12,
  topics_discussed: ["factoring quadratics MEMSENTINEL_TOPIC"],
  skills_referenced: ["Equivalent Expressions"],
  key_insights: ["sees the common factor MEMSENTINEL_INSIGHT"],
  unresolved_confusion: ["sign of the middle term MEMSENTINEL_CONFUSION"],
  last_student_direction: "wanted a harder one MEMSENTINEL_DIRECTION",
};
const SENTINELS = [
  "MEMSENTINEL_TOPIC",
  "MEMSENTINEL_INSIGHT",
  "MEMSENTINEL_CONFUSION",
  "MEMSENTINEL_DIRECTION",
];

function withMemory(content: Record<string, unknown>, version: string) {
  const base = buildGoldenEnvelope({
    surface: "practice",
    isPostSubmit: false,
    correctAnswer: "B",
    question: { stem: "x", options: [] },
    messages: [],
  } as never);
  return {
    ...base,
    policy_assignment: { ...base.policy_assignment, prompt_version: version },
    memory_summaries: [
      {
        summary_type: "chat_compaction",
        summary_version: "1.0",
        content_json: content,
        source_window_start: "2026-11-03T10:00:00Z",
        source_window_end: "2026-11-03T10:20:00Z",
      },
    ],
  } as Parameters<typeof buildSystemInstruction>[0];
}

/** The text between each data block's open and close marker. */
function dataBlocks(instruction: string): string[] {
  return [
    ...instruction.matchAll(/<<<DATA ([^>]*)>>>([\s\S]*?)<<<END_DATA>>>/g),
  ].map((m) => `${m[1] ?? ""}\n${m[2] ?? ""}`);
}

describe("W4-16: memory renders what compaction writes, on the evaluated line only", () => {
  it("M1 v5 carries every compaction field inside a memory.chat_compaction data block", () => {
    const sys = buildSystemInstruction(
      withMemory(COMPACTION, "lisa-default-v5"),
    );
    const blocks = dataBlocks(sys).filter((b) =>
      b.startsWith("memory.chat_compaction"),
    );
    expect(blocks).toHaveLength(1);
    for (const s of SENTINELS) {
      expect(blocks[0]).toContain(s);
      // Present only inside the block: never as bare text outside it.
      expect(sys.split(s).length - 1).toBe(1);
    }
    expect(blocks[0]).not.toContain("Equivalent Expressions");
  });

  it("M2 v3 and v4 render nothing from the same row, as before", () => {
    for (const v of ["lisa-default-v3", "lisa-default-v4"]) {
      const sys = buildSystemInstruction(withMemory(COMPACTION, v));
      for (const s of SENTINELS) expect(sys).not.toContain(s);
      expect(sys).not.toContain("[MEMORY");
    }
  });

  it("M3 a row outside the compaction schema keeps the old text read on every line", () => {
    for (const v of ["lisa-default-v3", "lisa-default-v5"]) {
      const sys = buildSystemInstruction(
        withMemory({ text: "OLDTEXT_SENTINEL" }, v),
      );
      expect(sys).toContain("OLDTEXT_SENTINEL");
    }
  });

  it("compactionText leaves out empty fields and is null when nothing is worth carrying", () => {
    expect(
      compactionText({
        ...COMPACTION,
        summary_version: "1.0",
        topics_discussed: [],
        key_insights: [],
        unresolved_confusion: [],
        last_student_direction: null,
      }),
    ).toBeNull();
    expect(
      compactionText({
        ...COMPACTION,
        summary_version: "1.0",
        key_insights: [],
      }),
    ).not.toContain("What clicked");
  });
});
