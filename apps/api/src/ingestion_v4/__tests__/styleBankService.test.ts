import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn()
}));

import { getSupabaseAdmin } from "../../lib/supabase-admin";

describe("styleBankService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("scanStyleBank", () => {
    it("filters for PDF files only", async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: [
          { name: "test1.pdf", metadata: { size: 1000 } },
          { name: "test2.txt", metadata: { size: 500 } },
          { name: "test3.PDF", metadata: { size: 2000 } },
          { name: "folder", metadata: {} }
        ],
        error: null
      });

      const mockStorage = {
        from: vi.fn().mockReturnValue({
          list: mockList
        })
      };

      (getSupabaseAdmin as any).mockReturnValue({ storage: mockStorage });

      const { scanStyleBank } = await import("../services/styleBankService");
      const result = await scanStyleBank(100);

      expect(result.ok).toBe(true);
      const pdfNames = result.entries.map((e) => e.name);
      expect(pdfNames).toContain("test1");
      expect(pdfNames).toContain("test3");
      expect(pdfNames).not.toContain("test2");
      expect(pdfNames).not.toContain("folder");
    });

    it("respects limit parameter", async () => {
      const mockData = Array.from({ length: 50 }, (_, i) => ({
        name: `file${i}.pdf`,
        metadata: { size: 1000 }
      }));

      const mockList = vi.fn().mockResolvedValue({
        data: mockData,
        error: null
      });

      const mockStorage = {
        from: vi.fn().mockReturnValue({
          list: mockList
        })
      };

      (getSupabaseAdmin as any).mockReturnValue({ storage: mockStorage });

      const { scanStyleBank } = await import("../services/styleBankService");
      const result = await scanStyleBank(10);

      expect(result.entries.length).toBeLessThanOrEqual(10);
      expect(result.truncated).toBe(true);
    });
  });

  describe("syncStyleBankToLibrary", () => {
    it("returns counts for sync operation", async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: [{ name: "test.pdf", metadata: { size: 1000 } }],
        error: null
      });

      const mockInsert = vi.fn().mockReturnValue({
        error: null
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      });

      const mockFrom = vi.fn().mockReturnValue({
        select: mockSelect,
        insert: mockInsert
      });

      const mockStorage = {
        from: vi.fn().mockReturnValue({
          list: mockList
        })
      };

      (getSupabaseAdmin as any).mockReturnValue({
        storage: mockStorage,
        from: mockFrom
      });

      const { syncStyleBankToLibrary } = await import("../services/styleBankService");
      const result = await syncStyleBankToLibrary();

      expect(result.ok).toBe(true);
      expect(typeof result.inserted).toBe("number");
      expect(typeof result.skipped).toBe("number");
      expect(typeof result.totalSeen).toBe("number");
    });
  });
});
