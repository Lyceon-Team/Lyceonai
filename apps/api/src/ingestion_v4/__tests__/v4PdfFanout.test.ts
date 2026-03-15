import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockGetSupabaseAdmin = vi.fn(() => ({
  rpc: mockRpc,
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
}));

vi.mock("../services/styleBankService", () => ({
  scanStyleBank: vi.fn().mockResolvedValue({
    entries: [{ path: "sat/math/pdf/test.pdf", section: "math" }],
  }),
}));

vi.mock("../services/v4Queue", () => ({
  SYSTEM_JOB_ID: "00000000-0000-0000-0000-000000000001",
  ensureSystemJobExists: vi.fn().mockResolvedValue(undefined),
}));

import { runPdfFanout } from "../services/v4PdfFanout";

describe("v4PdfFanout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("RPC fallback behavior", () => {
    it("tries v2 RPC first, uses its result if available", async () => {
      mockRpc.mockResolvedValue({
        data: [{ inserted: true, queue_id: "v2-123", reason: "queued" }],
        error: null,
      });

      const result = await runPdfFanout({ dryRun: false });

      expect(mockRpc).toHaveBeenCalledWith("enqueue_render_pages_if_missing_v2", expect.any(Object));
      expect(result.enqueued).toBe(1);
      expect(result.details[0].queueId).toBe("v2-123");
    });

    it("falls back to v1 RPC if v2 returns function not found", async () => {
      mockRpc
        .mockResolvedValueOnce({
          data: null,
          error: { message: "function enqueue_render_pages_if_missing_v2 does not exist" },
        })
        .mockResolvedValueOnce({
          data: [{ inserted: true, queue_id: "v1-456", reason: "queued" }],
          error: null,
        });

      const result = await runPdfFanout({ dryRun: false });

      expect(mockRpc).toHaveBeenCalledTimes(2);
      expect(mockRpc).toHaveBeenNthCalledWith(1, "enqueue_render_pages_if_missing_v2", expect.any(Object));
      expect(mockRpc).toHaveBeenNthCalledWith(2, "enqueue_render_pages_if_missing", expect.any(Object));
      expect(result.enqueued).toBe(1);
      expect(result.details[0].queueId).toBe("v1-456");
    });

    it("returns error if v2 fails with non-missing-function error", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "permission denied" },
      });

      const result = await runPdfFanout({ dryRun: false });

      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(result.errors).toBe(1);
      expect(result.details[0].status).toBe("error");
      expect(result.details[0].reason).toBe("permission denied");
    });
  });

  describe("response normalization", () => {
    it("handles PostgREST array return with inserted=true", async () => {
      mockRpc.mockResolvedValue({
        data: [{ inserted: true, queue_id: "abc-123", reason: "queued" }],
        error: null,
      });

      const result = await runPdfFanout({ dryRun: false });

      expect(result.enqueued).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.details[0].status).toBe("enqueued");
      expect(result.details[0].reason).toBe("queued");
      expect(result.details[0].queueId).toBe("abc-123");
    });

    it("handles PostgREST array return with inserted=false", async () => {
      mockRpc.mockResolvedValue({
        data: [{ inserted: false, queue_id: "existing-456", reason: "already_pending" }],
        error: null,
      });

      const result = await runPdfFanout({ dryRun: false });

      expect(result.enqueued).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.details[0].status).toBe("skipped");
      expect(result.details[0].reason).toBe("already_pending");
    });

    it("handles PostgREST single object return", async () => {
      mockRpc.mockResolvedValue({
        data: { inserted: true, queue_id: "single-789", reason: "queued" },
        error: null,
      });

      const result = await runPdfFanout({ dryRun: false });

      expect(result.enqueued).toBe(1);
      expect(result.details[0].status).toBe("enqueued");
      expect(result.details[0].queueId).toBe("single-789");
    });

    it("handles empty RPC return as error", async () => {
      mockRpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await runPdfFanout({ dryRun: false });

      expect(result.enqueued).toBe(0);
      expect(result.errors).toBe(1);
      expect(result.details[0].status).toBe("error");
      expect(result.details[0].reason).toBe("rpc_return_empty");
    });

    it("handles null RPC return as error", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await runPdfFanout({ dryRun: false });

      expect(result.enqueued).toBe(0);
      expect(result.errors).toBe(1);
      expect(result.details[0].reason).toBe("rpc_return_empty");
    });
  });

  describe("overwrite parameter", () => {
    it("passes overwrite option through to RPC call", async () => {
      mockRpc.mockResolvedValue({
        data: [{ inserted: true, queue_id: "ow-123", reason: "overwritten" }],
        error: null,
      });

      await runPdfFanout({ dryRun: false, overwrite: true });

      expect(mockRpc).toHaveBeenCalledWith("enqueue_render_pages_if_missing_v2", {
        p_job_id: "00000000-0000-0000-0000-000000000001",
        p_payload: expect.objectContaining({ overwrite: true }),
        p_overwrite: true,
      });
    });
  });
});
