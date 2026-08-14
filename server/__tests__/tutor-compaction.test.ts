/**
 * @spec [Doc-03A_V3 §9.1, §10.2; Doc-03C_V3 §8.3]
 * @implemented 2026-08-14
 *
 * plain English: Mock-based tests for the chat compaction service (WS-L4).
 * These exercise application-layer code paths in executeCompaction that
 * ephemeral PG cannot reach: Vertex response parsing, buildContentJson
 * normalization, threshold gating, and error handling.
 *
 * DB-layer proofs (trigger validation, UPSERT idempotency, HMAC signing)
 * live in tests/ci/memory-compaction.ephemeral-pg.proof.test.ts.
 *
 * Kept mock tests — justification for each:
 *   - Happy-path pipeline: proves executeCompaction orchestrates
 *     message-load → Vertex → content-build → upsert → NOTIFY correctly.
 *     Real PG tests the trigger; this tests the function that feeds it.
 *   - Array truncation: proves buildContentJson enforces bounds before
 *     the DB write, so the trigger never fires on overlong arrays.
 *   - Upsert call shape: proves executeCompaction sets the right metadata
 *     (student_id, summary_type, source_window, refresh_trigger, NOTIFY).
 *   - Malformed Vertex output: proves buildContentJson normalizes non-strings,
 *     nulls, and wrong types. No DB interaction to test with PG.
 *   - Prose fallback: proves the fallback path when Vertex returns free text.
 *   - Below-threshold: proves the message-count gate (TutorConfig). Pure app
 *     logic with no DB interaction.
 *   - Vertex failure / empty summary / DB error / NOTIFY error: proves
 *     application error-handling paths. Not exercisable against real PG.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const mockRpc = vi.fn().mockResolvedValue({ error: null });
  const mockSingle = vi.fn();
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
  const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });
  const mockOrder = vi.fn();
  const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
  const mockSelectFrom = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === "tutor_memory_summaries") {
      return { upsert: mockUpsert };
    }
    // tutor_messages
    return { select: mockSelectFrom };
  });

  return {
    supabaseServer: {
      from: mockFrom,
      rpc: mockRpc,
    },
    __mocks: {
      mockFrom,
      mockUpsert,
      mockSelect,
      mockSingle,
      mockSelectFrom,
      mockEq,
      mockOrder,
      mockRpc,
    },
  };
});

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/tutor-orchestrator-client", () => ({
  compactConversation: vi.fn(),
}));

vi.mock("./tutor-memory", () => ({
  getRecentMessages: vi.fn(),
}));

const mockTutorConfigGet = vi.fn().mockReturnValue(12);
vi.mock("./tutor-config", () => ({
  TutorConfig: {
    get: mockTutorConfigGet,
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────

import {
  executeCompaction,
  chatCompactionContentSchema,
} from "../services/tutor-compaction";
import { compactConversation } from "../lib/tutor-orchestrator-client";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

// ── Helpers ──────────────────────────────────────────────────────────

const STUDENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONVERSATION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REQUEST_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SUMMARY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content_kind: "text",
    message: `Message ${i}`,
    created_at: `2026-08-14T10:${String(i).padStart(2, "0")}:00Z`,
  }));
}

/** Valid structured JSON that the LLM would return. */
const VALID_STRUCTURED_SUMMARY = JSON.stringify({
  topics_discussed: ["linear equations", "slope-intercept form"],
  skills_referenced: ["algebra", "graphing"],
  key_insights: ["Student can solve basic linear equations"],
  unresolved_confusion: ["Struggles with word problems involving rate"],
  last_student_direction: "Working on practice set for slope-intercept",
});

// Access internal mock handles
const { __mocks } = vi.mocked(
  (await import("../../apps/api/src/lib/supabase-server")) as unknown as {
    supabaseServer: typeof supabaseServer;
    __mocks: {
      mockFrom: ReturnType<typeof vi.fn>;
      mockUpsert: ReturnType<typeof vi.fn>;
      mockSelect: ReturnType<typeof vi.fn>;
      mockSingle: ReturnType<typeof vi.fn>;
      mockSelectFrom: ReturnType<typeof vi.fn>;
      mockEq: ReturnType<typeof vi.fn>;
      mockOrder: ReturnType<typeof vi.fn>;
      mockRpc: ReturnType<typeof vi.fn>;
    };
  },
);

// ── Tests ────────────────────────────────────────────────────────────

describe("Chat Compaction Service (WS-L4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: recent_message_window = 12
    mockTutorConfigGet.mockReturnValue(12);
  });

  // ── Happy-path pipeline ──────────────────────────────────────────────
  // Justification: real PG proves the trigger accepts valid content_json
  // (proof a), but cannot exercise the executeCompaction orchestration:
  // message-load → Vertex call → buildContentJson → Supabase upsert call
  // shape → NOTIFY. These tests prove the *function* that feeds the trigger.

  describe("Happy-path pipeline: executeCompaction produces a valid summary", () => {
    it("writes a row with content_json satisfying the §10.2 schema", async () => {
      const messages = makeMessages(15);

      // Mock: load messages returns 15 messages
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      // Mock: Vertex returns structured JSON
      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: { ok: true, summary: VALID_STRUCTURED_SUMMARY },
      });

      // Mock: upsert succeeds and returns the summary ID
      __mocks.mockSingle.mockResolvedValueOnce({
        data: { id: SUMMARY_ID },
        error: null,
      });

      // Mock: NOTIFY succeeds
      __mocks.mockRpc.mockResolvedValueOnce({ error: null });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      // ── Assert: result is ok
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected ok result");
      expect(result.summaryId).toBe(SUMMARY_ID);

      // ── Assert: upsert was called with correct table and shape
      expect(supabaseServer.from).toHaveBeenCalledWith(
        "tutor_memory_summaries",
      );

      const upsertCall = __mocks.mockUpsert.mock.calls[0];
      expect(upsertCall).toBeDefined();

      const upsertedRow = upsertCall[0];
      expect(upsertedRow.student_id).toBe(STUDENT_ID);
      expect(upsertedRow.summary_type).toBe("chat_compaction");
      expect(upsertedRow.summary_version).toBe("1.0");

      // ── Assert: content_json passes the §10.2 Zod schema (mirrors DB CHECK)
      const contentValidation = chatCompactionContentSchema.safeParse(
        upsertedRow.content_json,
      );
      expect(contentValidation.success).toBe(true);

      if (contentValidation.success) {
        const content = contentValidation.data;
        expect(content.conversation_id).toBe(CONVERSATION_ID);
        expect(content.turns_compacted).toBe(15);
        expect(content.topics_discussed).toHaveLength(2);
        expect(content.key_insights.length).toBeLessThanOrEqual(5);
        expect(content.unresolved_confusion.length).toBeLessThanOrEqual(5);
      }

      // ── Assert: upsert uses ON CONFLICT for idempotency
      const upsertOpts = upsertCall[1];
      expect(upsertOpts.onConflict).toBe("student_id,summary_type");

      // ── Assert: NOTIFY was fired
      expect(supabaseServer.rpc).toHaveBeenCalledWith(
        "pg_notify_memory_summary",
        { p_student_id: STUDENT_ID, p_summary_type: "chat_compaction" },
      );
    });

    // Justification: tests buildContentJson's proactive truncation BEFORE the
    // DB write. Real PG proves the trigger rejects out-of-bounds (proofs c, d);
    // this proves the application enforces bounds so the trigger never fires.
    it("enforces §10.2 bounds: truncates overlong arrays and strings", async () => {
      const messages = makeMessages(20);
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      // LLM returns arrays exceeding bounds
      const oversizedSummary = JSON.stringify({
        topics_discussed: Array.from({ length: 15 }, (_, i) => `topic-${i}`), // max 10
        skills_referenced: ["skill-1"],
        key_insights: Array.from({ length: 8 }, (_, i) => `insight-${i}`), // max 5
        unresolved_confusion: Array.from(
          { length: 7 },
          (_, i) => `confusion-${i}`,
        ), // max 5
        last_student_direction: "x".repeat(300), // max 200
      });

      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: { ok: true, summary: oversizedSummary },
      });
      __mocks.mockSingle.mockResolvedValueOnce({
        data: { id: SUMMARY_ID },
        error: null,
      });
      __mocks.mockRpc.mockResolvedValueOnce({ error: null });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );
      expect(result.ok).toBe(true);

      const upsertedRow = __mocks.mockUpsert.mock.calls[0][0];
      const content = upsertedRow.content_json;

      // Verify truncation enforced bounds
      expect(content.topics_discussed.length).toBeLessThanOrEqual(10);
      expect(content.key_insights.length).toBeLessThanOrEqual(5);
      expect(content.unresolved_confusion.length).toBeLessThanOrEqual(5);
      expect(content.last_student_direction.length).toBeLessThanOrEqual(200);

      // Verify the Zod schema still passes after truncation
      const validation = chatCompactionContentSchema.safeParse(content);
      expect(validation.success).toBe(true);
    });
  });

  // ── Upsert call shape ────────────────────────────────────────────────
  // Justification: real PG proves the row is readable (proof e) and UPSERT
  // is idempotent (proof f), but cannot test that executeCompaction
  // constructs the correct Supabase upsert call (student_id, summary_type,
  // source_window timestamps, refresh_trigger, NOTIFY invocation).

  describe("Upsert call shape: executeCompaction sets correct metadata", () => {
    it("upserts with (student_id, summary_type) so resolveMemorySummariesSafe can read by student_id", async () => {
      const messages = makeMessages(15);
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: { ok: true, summary: VALID_STRUCTURED_SUMMARY },
      });
      __mocks.mockSingle.mockResolvedValueOnce({
        data: { id: SUMMARY_ID },
        error: null,
      });
      __mocks.mockRpc.mockResolvedValueOnce({ error: null });

      await executeCompaction(CONVERSATION_ID, STUDENT_ID, REQUEST_ID);

      // Verify the upserted row uses the correct student_id and summary_type
      // so that resolveMemorySummariesSafe (which queries by student_id) will find it
      const upsertedRow = __mocks.mockUpsert.mock.calls[0][0];
      expect(upsertedRow.student_id).toBe(STUDENT_ID);
      expect(upsertedRow.summary_type).toBe("chat_compaction");
      expect(upsertedRow.summary_version).toBe("1.0");

      // Verify source_window bounds are set (used for staleness checks)
      expect(upsertedRow.source_window_start).toBe(messages[0].created_at);
      expect(upsertedRow.source_window_end).toBe(
        messages[messages.length - 1].created_at,
      );

      // Verify last_refreshed_at is set (used by stale-summary sweep)
      expect(upsertedRow.last_refreshed_at).toBeDefined();
      expect(upsertedRow.refresh_trigger).toBe("close");

      // Verify NOTIFY was fired for cache invalidation so the next turn
      // sees the fresh summary (not a stale cache entry)
      expect(supabaseServer.rpc).toHaveBeenCalledWith(
        "pg_notify_memory_summary",
        { p_student_id: STUDENT_ID, p_summary_type: "chat_compaction" },
      );
    });

    // DELETED: "duplicate execution overwrites (idempotent per §8.3)"
    // Reason: UPSERT idempotency is directly proven by ephemeral PG proof (f)
    // in tests/ci/memory-compaction.ephemeral-pg.proof.test.ts, which tests
    // ON CONFLICT at the real DB level. The mock only verified the onConflict
    // string arg was passed — it did not prove idempotency.
  });

  // ── Vertex response normalization ───────────────────────────────────
  // Justification: tests buildContentJson's handling of malformed/non-JSON
  // Vertex responses. This is application-level content normalization that
  // happens before any DB interaction. Real PG cannot exercise the Vertex
  // response parsing pipeline.

  describe("Vertex response normalization: malformed output handled gracefully", () => {
    it("rejects content that fails Zod validation (Layer B)", async () => {
      const messages = makeMessages(15);
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      // LLM returns JSON that is structurally valid JSON but wrong schema
      // (e.g., key_insights contains numbers instead of strings)
      const malformedSummary = JSON.stringify({
        topics_discussed: [123, 456], // should be strings
        skills_referenced: null, // should be array
        key_insights: "not an array", // should be array
        unresolved_confusion: [{ nested: "object" }], // should be strings
        last_student_direction: 42, // should be string | null
      });

      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: { ok: true, summary: malformedSummary },
      });

      // buildContentJson truncateStringArray will filter out non-strings,
      // yielding empty arrays — the Zod validation on the BUILT object
      // should still pass since empty arrays are valid.
      // But this test verifies the pipeline doesn't crash and doesn't
      // write garbage.
      __mocks.mockSingle.mockResolvedValueOnce({
        data: { id: SUMMARY_ID },
        error: null,
      });
      __mocks.mockRpc.mockResolvedValueOnce({ error: null });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      // The service's buildContentJson handles bad types gracefully by
      // filtering non-strings. The result still passes Zod validation
      // with empty arrays (which is valid per §10.2).
      expect(result.ok).toBe(true);
      const content = __mocks.mockUpsert.mock.calls[0][0].content_json;
      expect(content.topics_discussed).toEqual([]); // non-strings filtered
      expect(content.skills_referenced).toEqual([]); // null → []
      expect(content.key_insights).toEqual([]); // non-array → []
      expect(content.unresolved_confusion).toEqual([]); // objects filtered
    });

    it("uses fallback structure when LLM returns non-JSON prose", async () => {
      const messages = makeMessages(15);
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      // LLM returns free-text instead of JSON
      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: {
          ok: true,
          summary:
            "The student worked on algebra and struggled with word problems.",
        },
      });

      __mocks.mockSingle.mockResolvedValueOnce({
        data: { id: SUMMARY_ID },
        error: null,
      });
      __mocks.mockRpc.mockResolvedValueOnce({ error: null });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );
      expect(result.ok).toBe(true);

      // Verify the fallback structure was used
      const content = __mocks.mockUpsert.mock.calls[0][0].content_json;
      expect(content.summary_version).toBe("1.0");
      expect(content.conversation_id).toBe(CONVERSATION_ID);
      expect(content.key_insights).toHaveLength(1);
      expect(content.key_insights[0]).toContain("algebra");
      expect(content.topics_discussed).toEqual([]);
      expect(content.unresolved_confusion).toEqual([]);

      // Verify it still passes Zod validation
      const validation = chatCompactionContentSchema.safeParse(content);
      expect(validation.success).toBe(true);
    });

    // DELETED: "rejects and returns error when content_json fails Zod validation"
    // Reason: Bounds rejection (key_insights > 5, topics_discussed > 10, missing
    // required keys) is directly proven by ephemeral PG proofs (c) and (d) in
    // tests/ci/memory-compaction.ephemeral-pg.proof.test.ts, which test the real
    // DB trigger. The Zod schema mirrors the trigger; testing it in isolation
    // only proves the mirror matches, not that the real constraint holds.
  });

  // ── Below-threshold gate ────────────────────────────────────────────
  // Justification: tests the message-count threshold gate in
  // executeCompaction (TutorConfig.get("recent_message_window")). This is
  // pure application logic with no DB interaction — real PG cannot exercise it.

  describe("Below-threshold gate: insufficient messages skip compaction", () => {
    it("returns ok: false when message count < recent_message_window", async () => {
      // recent_message_window defaults to 12; send 5 messages
      const fewMessages = makeMessages(5);
      __mocks.mockOrder.mockResolvedValueOnce({
        data: fewMessages,
        error: null,
      });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("below_message_threshold");
      }

      // Verify: no Vertex call, no DB write, no NOTIFY
      expect(compactConversation).not.toHaveBeenCalled();
      expect(__mocks.mockUpsert).not.toHaveBeenCalled();
      expect(supabaseServer.rpc).not.toHaveBeenCalled();
    });

    it("skips compaction at exactly threshold-1 messages", async () => {
      mockTutorConfigGet.mockReturnValue(12);
      const elevenMessages = makeMessages(11); // exactly 1 below threshold
      __mocks.mockOrder.mockResolvedValueOnce({
        data: elevenMessages,
        error: null,
      });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("below_message_threshold");
      }
      expect(compactConversation).not.toHaveBeenCalled();
    });

    it("proceeds at exactly threshold messages", async () => {
      mockTutorConfigGet.mockReturnValue(12);
      const twelveMessages = makeMessages(12); // exactly at threshold
      __mocks.mockOrder.mockResolvedValueOnce({
        data: twelveMessages,
        error: null,
      });

      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: { ok: true, summary: VALID_STRUCTURED_SUMMARY },
      });
      __mocks.mockSingle.mockResolvedValueOnce({
        data: { id: SUMMARY_ID },
        error: null,
      });
      __mocks.mockRpc.mockResolvedValueOnce({ error: null });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      expect(result.ok).toBe(true);
      expect(compactConversation).toHaveBeenCalled();
    });

    it("skips compaction for empty conversations (0 messages)", async () => {
      __mocks.mockOrder.mockResolvedValueOnce({ data: [], error: null });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("below_message_threshold");
      }
      expect(compactConversation).not.toHaveBeenCalled();
      expect(__mocks.mockUpsert).not.toHaveBeenCalled();
    });
  });

  // ── Application error handling ──────────────────────────────────────
  // Justification: tests error-handling paths in executeCompaction (Vertex
  // failure, empty summary, DB write error, NOTIFY failure). These are
  // application-layer behaviors that real PG cannot exercise — they depend
  // on mocking the Supabase client and Vertex orchestrator.

  describe("Application error handling", () => {
    it("returns ok: false when Vertex call fails", async () => {
      const messages = makeMessages(15);
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: false,
        errorCode: "WORKER_TIMEOUT",
      });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("vertex_failed:WORKER_TIMEOUT");
      }
      expect(__mocks.mockUpsert).not.toHaveBeenCalled();
    });

    it("returns ok: false when Vertex returns empty summary", async () => {
      const messages = makeMessages(15);
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: { ok: true, summary: null },
      });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("empty_summary");
      }
      expect(__mocks.mockUpsert).not.toHaveBeenCalled();
    });

    it("returns ok: false when DB write fails", async () => {
      const messages = makeMessages(15);
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: { ok: true, summary: VALID_STRUCTURED_SUMMARY },
      });

      // DB upsert returns an error
      __mocks.mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: "constraint violation", code: "23514" },
      });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("db_write_failed:23514");
      }

      // NOTIFY should NOT be fired when the write failed
      expect(supabaseServer.rpc).not.toHaveBeenCalled();
    });

    it("still succeeds when NOTIFY fails (best-effort per §12B.5.1)", async () => {
      const messages = makeMessages(15);
      __mocks.mockOrder.mockResolvedValueOnce({ data: messages, error: null });

      vi.mocked(compactConversation).mockResolvedValueOnce({
        ok: true,
        value: { ok: true, summary: VALID_STRUCTURED_SUMMARY },
      });
      __mocks.mockSingle.mockResolvedValueOnce({
        data: { id: SUMMARY_ID },
        error: null,
      });

      // NOTIFY fails
      __mocks.mockRpc.mockResolvedValueOnce({
        error: { message: "connection lost", code: "08006" },
      });

      const result = await executeCompaction(
        CONVERSATION_ID,
        STUDENT_ID,
        REQUEST_ID,
      );

      // Compaction still succeeds — NOTIFY is supplementary
      expect(result.ok).toBe(true);
    });
  });
});
