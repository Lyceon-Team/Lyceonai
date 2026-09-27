/**
 * @spec [Doc-03A_V3.0 §18.7; owner ruling 2026-09-24 (closure plan W4-3: enable)]
 * @implemented 2026-09-24
 *
 * plain English: TutorConfig.loadAll() was never called, so every key served
 * its hardcoded default on every request and logged `cache_not_loaded` each
 * time. This pins the boot load that replaces that:
 *   - bootLoad() reads the database once, and get() then returns DB values
 *   - it is single-flight (two callers, one query)
 *   - a failed load logs ERROR boot_load_failed, does not throw, and leaves
 *     the spec defaults in place
 *   - get() before a load returns the default with NO per-call warning
 *   - whenBooted() is bounded: a hung load does not hang the request
 *   - server/index.ts starts the load at module scope and gates the two
 *     routers that read config on it
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SelectResult = {
  data: Array<Record<string, unknown>> | null;
  error: { message: string; code?: string } | null;
};

const selectImpl = vi.fn<() => Promise<SelectResult>>();

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({ select: () => selectImpl() }),
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { TutorConfig } from "../../server/services/tutor-config";
import { logger } from "../../server/logger";

function row(
  key: string,
  value: unknown,
  value_type: string,
): Record<string, unknown> {
  return {
    key,
    value,
    value_type,
    owner: "lisa",
    description: "test",
    environment: "all",
    updated_at: "2026-09-24T00:00:00Z",
  };
}

// The production values read 2026-09-24 for the six keys the runtime reads.
const PRODUCTION_ROWS = [
  row("recent_message_window", 12, "integer"),
  row("observation_promotion_threshold", 5, "integer"),
  row("friction_long_pause_seconds", 120, "integer"),
  row("tutor_request_timeout_seconds", 30, "integer"),
  row("model_armor_input_template_id", "lyceon-lisa-input-v1", "string"),
  row("model_armor_output_template_id", "lyceon-lisa-output-v1", "string"),
];

beforeEach(() => {
  TutorConfig._resetForTests();
  selectImpl.mockReset();
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();
});

describe("TutorConfig boot load (W4-3)", () => {
  it("before any load, get() returns the default and does NOT warn", () => {
    expect(TutorConfig.get("recent_message_window")).toBe(12);
    expect(TutorConfig.get("model_armor_input_template_id")).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("bootLoad reads the database once; get() then returns database values", async () => {
    selectImpl.mockResolvedValue({ data: PRODUCTION_ROWS, error: null });

    await Promise.all([TutorConfig.bootLoad(), TutorConfig.bootLoad()]);

    expect(selectImpl).toHaveBeenCalledTimes(1);
    expect(TutorConfig.isCacheLoaded()).toBe(true);
    // The two keys whose database value differs from the default.
    expect(TutorConfig.get("model_armor_input_template_id")).toBe(
      "lyceon-lisa-input-v1",
    );
    expect(TutorConfig.get("model_armor_output_template_id")).toBe(
      "lyceon-lisa-output-v1",
    );
    // The four that match their default are unchanged.
    expect(TutorConfig.get("recent_message_window")).toBe(12);
    expect(TutorConfig.get("observation_promotion_threshold")).toBe(5);
    expect(TutorConfig.get("friction_long_pause_seconds")).toBe(120);
    expect(TutorConfig.get("tutor_request_timeout_seconds")).toBe(30);

    // The boot log shows the effective values, so the change is visible.
    expect(logger.info).toHaveBeenCalledWith(
      "TUTOR_CONFIG",
      "cache_loaded",
      expect.any(String),
      expect.objectContaining({
        keyCount: 6,
        effective: expect.objectContaining({
          recent_message_window: 12,
          model_armor_input_template_id: "lyceon-lisa-input-v1",
        }),
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("a failed load logs ERROR boot_load_failed, does not reject, and keeps defaults", async () => {
    selectImpl.mockResolvedValue({
      data: null,
      error: { message: "connection refused", code: "08006" },
    });

    await expect(TutorConfig.bootLoad()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "TUTOR_CONFIG",
      "boot_load_failed",
      expect.any(String),
      expect.objectContaining({
        message: expect.stringContaining("connection refused"),
      }),
    );
    expect(TutorConfig.isCacheLoaded()).toBe(false);
    expect(TutorConfig.get("recent_message_window")).toBe(12);
    expect(TutorConfig.get("model_armor_input_template_id")).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("whenBooted is bounded: a hung load does not hold the request past the timeout", async () => {
    selectImpl.mockImplementation(() => new Promise<SelectResult>(() => {}));
    const started = Date.now();
    await TutorConfig.whenBooted(50);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(TutorConfig.isCacheLoaded()).toBe(false);
  });

  it("server/index.ts starts the load at module scope and gates both config-reading routers", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/^void TutorConfig\.bootLoad\(\);$/m);
    // The gate sits in front of the tutor router and the internal memory
    // (compaction) router — the two that call TutorConfig.get().
    expect(src).toMatch(/awaitTutorConfig,\s*tutorRuntimeRouter,/);
    expect(src).toMatch(
      /app\.use\("\/api\/internal", awaitTutorConfig, internalMemoryRoutes\)/,
    );
  });
});
