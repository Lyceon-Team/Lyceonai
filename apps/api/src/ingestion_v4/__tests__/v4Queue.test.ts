/**
 * V4 Queue Tests
 * 
 * Tests for dequeueNext empty-row handling and null payload scenarios
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRpc = vi.fn();
const mockSupabase = {
  rpc: mockRpc,
};

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => mockSupabase,
}));

import { dequeueNext } from "../services/v4Queue";

describe("v4Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("dequeueNext", () => {
    it("should return null when rpc returns null", async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).toBeNull();
    });

    it("should return null when rpc returns empty object", async () => {
      mockRpc.mockResolvedValue({ data: {}, error: null });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).toBeNull();
    });

    it("should return null when rpc returns object with null id and null payload", async () => {
      mockRpc.mockResolvedValue({ 
        data: { id: null, payload: null, status: null }, 
        error: null 
      });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).toBeNull();
    });

    it("should return null when rpc returns object with null id but valid payload", async () => {
      mockRpc.mockResolvedValue({ 
        data: { id: null, payload: { type: "render_pages" } }, 
        error: null 
      });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).toBeNull();
    });

    it("should return null when rpc returns object with valid id but null payload", async () => {
      mockRpc.mockResolvedValue({ 
        data: { id: "some-uuid", payload: null }, 
        error: null 
      });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).toBeNull();
    });

    it("should return null when rpc returns object with undefined payload", async () => {
      mockRpc.mockResolvedValue({ 
        data: { id: "some-uuid", payload: undefined }, 
        error: null 
      });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).toBeNull();
    });

    it("should return null when rpc returns error", async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: "Connection failed" } });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).toBeNull();
    });

    it("should return valid QueueRow when rpc returns complete data", async () => {
      const validRow = {
        id: "queue-123",
        job_id: "job-456",
        payload: { type: "render_pages", bucket: "test" },
        status: "RUNNING",
        not_before: "2025-01-01T00:00:00Z",
        attempts: 1,
        locked_by: "test-runner",
        locked_at: "2025-01-01T00:00:00Z",
        started_at: null,
        completed_at: null,
        last_error: null,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };
      
      mockRpc.mockResolvedValue({ data: validRow, error: null });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).not.toBeNull();
      expect(result?.id).toBe("queue-123");
      expect(result?.payload).toEqual({ type: "render_pages", bucket: "test" });
    });

    it("should return valid QueueRow with empty object payload", async () => {
      const validRow = {
        id: "queue-123",
        job_id: "job-456",
        payload: {},
        status: "RUNNING",
        not_before: "2025-01-01T00:00:00Z",
        attempts: 1,
        locked_by: "test-runner",
        locked_at: "2025-01-01T00:00:00Z",
        started_at: null,
        completed_at: null,
        last_error: null,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };
      
      mockRpc.mockResolvedValue({ data: validRow, error: null });
      
      const result = await dequeueNext("test-runner");
      
      expect(result).not.toBeNull();
      expect(result?.id).toBe("queue-123");
      expect(result?.payload).toEqual({});
    });
  });
});
