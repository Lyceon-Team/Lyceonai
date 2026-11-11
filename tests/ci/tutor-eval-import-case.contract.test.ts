/**
 * The eval import parses production's rows as production stores them, and `--check` writes nothing.
 *
 * @spec [migration 20260805000000 TA-1 (`source_question_row_id` is TEXT, FK to `questions.id`,
 *       the canonical id); owner report 2026-11-11: every real import failed because the script
 *       parsed that column as a UUID] | @implemented [2026-11-11]
 *
 * plain English:
 *   R1 a conversation whose question row id is a canonical id (the shape production holds,
 *      e.g. SATM2CN39N2) parses; so does a review one and a dashboard one with no scope.
 *   R2 message rows: every role the table allows, timestamps in PostgREST's offset form.
 *   R3 item rows: every status both item tables allow; the pre-September review 'queued' does not.
 *   R4 a row that does not parse names the field and the reason, never the value.
 *   C1 `--check` runs the whole import on a canonical-id conversation, passes the canonical id to
 *      the scan-key and envelope readers, prints "checked, not written", and never touches
 *      `tutor_eval_cases`. Without `--check` the same case is written.
 *   C2 an item row that exists but does not parse is refused, not read as pre-submit.
 *
 * Fixtures are the shapes PostgREST returns for the columns in the migrations. The two question
 * ids are the ones production reported (2026-11-11); the conversation, student and message ids
 * and all text are synthetic. No student text exists in this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";
import type { OrchestrateRequest } from "../../shared/tutor-orchestrator-wire";

const db = { current: new FakeTutorDb() };
const tablesTouched: string[] = [];

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    const client = db.current.client();
    return {
      ...client,
      from: (table: string) => {
        tablesTouched.push(table);
        return client.from(table);
      },
    };
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/services/tutor-config", () => ({
  TutorConfig: { loadAll: vi.fn(async () => undefined) },
}));
vi.mock("../../server/services/tutor-video-library", () => ({
  requestedVideoMethod: () => ({ method: null, mapVersion: null }),
}));

const scanKeyCalls: Array<string | null> = [];
vi.mock("../../server/routes/tutor-runtime", () => ({
  getCorrectAnswerForScope: vi.fn(async (rowId: string | null) => {
    scanKeyCalls.push(rowId);
    return { value: rowId === null ? null : "B", failed: false };
  }),
}));

// The BFF's message-window reader, over the fake table: messages up to and including `asOf`.
vi.mock("../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(
    async (conversationId: string, _limit: unknown, asOf: string) =>
      db.current
        .rows("tutor_messages")
        .filter(
          (m) =>
            m["conversation_id"] === conversationId &&
            String(m["created_at"]) <= asOf,
        )
        .map((m) => ({
          id: m["id"],
          role: m["role"],
          content_kind: "message",
          message: m["message"],
          created_at: m["created_at"],
        })),
  ),
}));

// The BFF's envelope builder serves these same rows in production today; here it returns a
// wire-valid golden envelope carrying the scope the import passed in, so the test sees exactly
// what the import hands it.
const envelopeScopes: Array<string | null> = [];
vi.mock("../../server/services/tutor-context", async () => {
  const { buildGoldenEnvelope } = await import("./lisa-golden-set-helpers");
  return {
    resolveFullEnvelope: vi.fn(
      async (p: {
        conversationId: string;
        studentId: string;
        entryMode: OrchestrateRequest["entry_mode"];
        sourceSurface: OrchestrateRequest["source_surface"];
        sourceSessionId: string | null;
        sourceSessionItemId: string | null;
        sourceQuestionRowId: string | null;
        recentMessages: OrchestrateRequest["recent_messages"];
        correctAnswer: string | null;
        isPostSubmit: boolean;
      }): Promise<OrchestrateRequest> => {
        envelopeScopes.push(p.sourceQuestionRowId);
        const base = buildGoldenEnvelope({
          surface: "practice",
          isPostSubmit: p.isPostSubmit,
          question: {
            stem: "Synthetic stem.",
            options: [
              { key: "A", text: "1" },
              { key: "B", text: "2" },
            ],
          },
          correctAnswer: null,
        });
        return {
          ...base,
          conversation_id: p.conversationId,
          student_id: p.studentId,
          entry_mode: p.entryMode,
          source_surface: p.sourceSurface,
          resolved_scope: {
            source_session_id: p.sourceSessionId,
            source_session_item_id: p.sourceSessionItemId,
            source_question_row_id: p.sourceQuestionRowId,
            source_question_canonical_id: p.sourceQuestionRowId,
          },
          recent_messages: p.recentMessages,
          memory_summaries: [],
          is_post_submit: p.isPostSubmit,
          correct_answer: p.isPostSubmit ? p.correctAnswer : null,
        };
      },
    ),
  };
});

import {
  conversationRowSchema,
  messageRowSchema,
  parseRow,
  runImport,
  sessionItemRowSchema,
} from "../eval/teaching-quality/import-case";

const STUDENT = "6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const CONVERSATION = "7b2c3d4e-5f6a-4b7c-8d9e-9f0a1b2c3d4e";
const SESSION = "8c3d4e5f-6a7b-4c8d-9e0f-0a1b2c3d4e5f";
const ITEM = "9d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";
const CUTOFF = "0e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b";
const REPLY = "1f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c";

/** A practice conversation exactly as PostgREST returns the row (canonical question row id). */
function practiceConversationRow(): Record<string, unknown> {
  return {
    id: CONVERSATION,
    student_id: STUDENT,
    entry_mode: "scoped_question",
    source_surface: "practice",
    source_session_id: SESSION,
    source_session_item_id: ITEM,
    source_question_row_id: "SATM2CN39N2",
    source_question_canonical_id: "SATM2CN39N2",
  };
}

describe("import: production row shapes (2026-11-11)", () => {
  it("R1 a canonical question row id parses; so do review and unscoped conversations", () => {
    expect(
      parseRow("c", conversationRowSchema, practiceConversationRow()).ok,
    ).toBe(true);
    expect(
      parseRow("c", conversationRowSchema, {
        ...practiceConversationRow(),
        source_surface: "review",
        source_question_row_id: "SATM2CJGV14",
        source_question_canonical_id: "SATM2CJGV14",
      }).ok,
    ).toBe(true);
    expect(
      parseRow("c", conversationRowSchema, {
        ...practiceConversationRow(),
        entry_mode: "general",
        source_surface: "dashboard",
        source_session_id: null,
        source_session_item_id: null,
        source_question_row_id: null,
        source_question_canonical_id: null,
      }).ok,
    ).toBe(true);
  });

  it("R2 every message role the table allows, with PostgREST's timestamp form", () => {
    for (const role of ["student", "tutor", "system"]) {
      expect(
        parseRow("m", messageRowSchema, {
          id: CUTOFF,
          role,
          message: "synthetic",
          created_at: "2026-11-04T18:20:11.123456+00:00",
        }).ok,
      ).toBe(true);
    }
    expect(
      parseRow("m", messageRowSchema, {
        id: CUTOFF,
        role: "assistant",
        message: "synthetic",
        created_at: "2026-11-04T18:20:11+00:00",
      }).ok,
    ).toBe(false);
  });

  it("R3 every item status both tables allow; review's retired 'queued' does not", () => {
    for (const status of ["pending", "served", "answered", "skipped"]) {
      expect(
        parseRow("i", sessionItemRowSchema, { status, answered_at: null }).ok,
      ).toBe(true);
    }
    expect(
      parseRow("i", sessionItemRowSchema, {
        status: "answered",
        answered_at: "2026-11-04T18:19:02.5+00:00",
      }).ok,
    ).toBe(true);
    expect(
      parseRow("i", sessionItemRowSchema, {
        status: "queued",
        answered_at: null,
      }).ok,
    ).toBe(false);
  });

  it("R4 a failing row names the field and the reason, never the value", () => {
    const parsed = parseRow("tutor_conversations row", conversationRowSchema, {
      ...practiceConversationRow(),
      source_question_row_id: "not-a-question-id",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toBe(
      "tutor_conversations row does not parse: source_question_row_id: invalid_string",
    );
    expect(parsed.error).not.toContain("not-a-question-id");
  });
});

describe("import: --check on a canonical-id conversation (2026-11-11)", () => {
  beforeEach(() => {
    db.current = new FakeTutorDb();
    tablesTouched.length = 0;
    scanKeyCalls.length = 0;
    envelopeScopes.length = 0;
    db.current.seed("tutor_conversations", {
      ...practiceConversationRow(),
      created_at: "2026-11-04T18:15:00.000000+00:00",
    });
    db.current.seed("practice_session_items", {
      id: ITEM,
      status: "served",
      answered_at: null,
    });
    db.current.seed("tutor_messages", {
      id: CUTOFF,
      conversation_id: CONVERSATION,
      student_id: STUDENT,
      role: "student",
      message: "synthetic question",
      created_at: "2026-11-04T18:20:11.123456+00:00",
    });
    db.current.seed("tutor_messages", {
      id: REPLY,
      conversation_id: CONVERSATION,
      student_id: STUDENT,
      role: "tutor",
      message: "synthetic reply",
      created_at: "2026-11-04T18:20:15.654321+00:00",
    });
  });

  const ARGS = [
    "--case",
    "G0-2-04",
    "--conversation",
    CONVERSATION,
    "--cutoff",
    CUTOFF,
  ];

  it("C1 reads, parses and builds the request, and writes nothing", async () => {
    const line = await runImport([...ARGS, "--check"]);
    expect(line).toBe(
      "G0-2-04: checked, not written; 1 message(s) in the window; pre-submit; " +
        "item served; scan key set; memory 0 kept, 0 dropped as after the cut-off",
    );
    // The canonical id reached both readers that need it.
    expect(scanKeyCalls).toEqual(["SATM2CN39N2"]);
    expect(envelopeScopes).toEqual(["SATM2CN39N2"]);
    // Presence before absence: the reads happened, the write did not.
    expect(tablesTouched).toContain("tutor_conversations");
    expect(tablesTouched).toContain("practice_session_items");
    expect(tablesTouched).not.toContain("tutor_eval_cases");
  });

  it("C1 without --check the same case reaches the write", async () => {
    // The fake has no upsert, so reaching the write throws: proof the path got there.
    await expect(runImport(ARGS)).rejects.toThrow();
    expect(tablesTouched).toContain("tutor_eval_cases");
  });

  it("C2 an item row that exists but does not parse is refused, not read as pre-submit", async () => {
    const item = db.current
      .rows("practice_session_items")
      .find((r) => r["id"] === ITEM);
    if (item === undefined) throw new Error("fixture item missing");
    item["status"] = "queued";
    await expect(runImport([...ARGS, "--check"])).rejects.toThrow(
      "practice_session_items row does not parse: status: invalid_enum_value",
    );
  });
});
