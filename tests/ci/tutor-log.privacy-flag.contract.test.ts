import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the row passed to .insert(). The flag is read at module-load time, so
// each case sets process.env, resets the module registry, and re-imports.
const insertSpy = vi.fn(() => ({ error: null }));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({ insert: insertSpy }),
  },
}));

const baseParams = {
  userId: "u-1",
  mode: "chat",
  canonicalIdsUsed: ["c1"],
  message: "STUDENT VERBATIM MESSAGE",
  answer: "TUTOR VERBATIM ANSWER",
};

async function runWithFlag(value: string | undefined): Promise<Record<string, unknown>> {
  if (value === undefined) {
    delete process.env.TUTOR_VERBATIM_PERSIST;
  } else {
    process.env.TUTOR_VERBATIM_PERSIST = value;
  }
  vi.resetModules();
  const { logTutorInteraction } = await import("../../apps/api/src/lib/tutor-log");
  await logTutorInteraction(baseParams);
  return insertSpy.mock.calls[0][0] as Record<string, unknown>;
}

describe("logTutorInteraction — verbatim persistence gate (F-006; Privacy Policy §3.4 / Coding Standards §12.2)", () => {
  const original = process.env.TUTOR_VERBATIM_PERSIST;

  beforeEach(() => {
    insertSpy.mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TUTOR_VERBATIM_PERSIST;
    } else {
      process.env.TUTOR_VERBATIM_PERSIST = original;
    }
  });

  it("flag unset → message/answer persisted as null (non-verbatim default)", async () => {
    const row = await runWithFlag(undefined);
    expect(row.message).toBeNull();
    expect(row.answer).toBeNull();
  });

  it("flag literal 'false' → null", async () => {
    const row = await runWithFlag("false");
    expect(row.message).toBeNull();
    expect(row.answer).toBeNull();
  });

  it("flag truthy-but-not-'true' ('yes') → null (only the literal string 'true' enables)", async () => {
    const row = await runWithFlag("yes");
    expect(row.message).toBeNull();
    expect(row.answer).toBeNull();
  });

  it("flag literal 'true' → verbatim persisted (proves the gate is real, not always-null)", async () => {
    const row = await runWithFlag("true");
    expect(row.message).toBe(baseParams.message);
    expect(row.answer).toBe(baseParams.answer);
  });
});
