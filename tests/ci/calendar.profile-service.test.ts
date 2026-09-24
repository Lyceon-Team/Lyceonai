/**
 * CalendarProfileService — §8.1 bounds, sheet item 19's timezone fall-open, §12.1.
 *
 * @spec [Doc-05F_V1.0 §7.1, §8.1, §12.1, §15 PUT /api/calendar/profile, R-08-03;
 *        Doc_05F_formula_sheet.md §8 item 19] | @implemented [2026-09-21]
 *
 * The load-bearing test is the first one: an unrecognised timezone must return 200 with
 * Chicago stored, NOT a 400. Item 19 is the whole reason the zone is normalised in the
 * service instead of constrained in the schema, and a schema that rejected it would make
 * the rule unreachable while every other test here still passed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_ROWS,
  errReply,
  makeFakeClient,
  okReply,
  type FakeClient,
  type QueryState,
} from "./calendar.service-harness";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

type ProfileRow = {
  timezone: string;
  target_exam_date: string | null;
  target_score: number | null;
  study_days_mask: number;
  daily_minutes: number;
  full_length_weekday: number | null;
  planner_mode: "auto" | "custom";
  setup_completed_at: string | null;
};

const COMPLETE: ProfileRow = {
  timezone: "America/New_York",
  target_exam_date: null,
  target_score: 1400,
  study_days_mask: 62,
  daily_minutes: 60,
  full_length_weekday: 6,
  planner_mode: "auto",
  setup_completed_at: "2026-09-01T00:00:00.000Z",
};

/**
 * What the upsert reads back: the stored row merged over the prior one, minus the key
 * the service sends to identify the row. `studyProfileSchema` is `.strict()`, so the
 * fake has to hand back exactly the eight columns the SELECT names.
 */
function mergedRow(
  existing: ProfileRow | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "student_id") continue;
    base[key] = value;
  }
  return base;
}

let client: FakeClient;
let stored: Record<string, unknown> | null;

/**
 * @param existing the row already in `student_study_profile`, or null for a create.
 * @param knownZones the zones `calendar_is_known_timezone` answers true for.
 */
function scenario(options: {
  existing: ProfileRow | null;
  knownZones?: readonly string[];
  persistFails?: boolean;
}): void {
  stored = null;
  const known = options.knownZones ?? ["America/New_York", "America/Chicago", "Asia/Tokyo"];

  client = makeFakeClient({
    tables: {
      calendar_runtime_config: () => okReply(CONFIG_ROWS),
      student_study_profile: (state: QueryState) => {
        if (state.op === "upsert") {
          stored = state.payload as Record<string, unknown>;
          return okReply(mergedRow(options.existing, stored));
        }
        return okReply(options.existing);
      },
    },
    rpcs: {
      calendar_is_known_timezone: (args) =>
        okReply(known.includes(String(args.p_timezone))),
      calendar_persist_version: () =>
        options.persistFails === true
          ? errReply("calendar_persist_version: boom")
          : okReply({ version_no: 7, validator_result: "accepted" }),
    },
  });
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return client;
  },
}));

const { upsertStudyProfile, FALLBACK_TIMEZONE } = await import(
  "../../server/services/calendar/profile-service"
);

/** The upserted row, minus the keys the service always sends. */
function storedRow(): Record<string, unknown> {
  if (stored === null) throw new Error("nothing was upserted");
  return stored;
}

beforeEach(() => {
  stored = null;
});

describe("timezone fails open (sheet §8 item 19)", () => {
  it("stores America/Chicago for a zone pg_timezone_names does not know, and still succeeds", async () => {
    scenario({ existing: COMPLETE });

    const result = await upsertStudyProfile(STUDENT, {
      timezone: "Mars/Olympus",
      idempotency_key: KEY,
    });

    expect(result.ok).toBe(true);
    expect(storedRow().timezone).toBe(FALLBACK_TIMEZONE);
    expect(FALLBACK_TIMEZONE).toBe("America/Chicago");
  });

  it("stores a zone the database recognises exactly as given", async () => {
    scenario({ existing: COMPLETE });

    await upsertStudyProfile(STUDENT, { timezone: "Asia/Tokyo", idempotency_key: KEY });

    expect(storedRow().timezone).toBe("Asia/Tokyo");
  });

  it("falls open when the zone lookup itself fails, rather than refusing the save", async () => {
    scenario({ existing: COMPLETE });
    const failing = makeFakeClient({
      tables: {
        calendar_runtime_config: () => okReply(CONFIG_ROWS),
        student_study_profile: (state) => {
          if (state.op === "upsert") {
            stored = state.payload as Record<string, unknown>;
            return okReply(mergedRow(COMPLETE, stored));
          }
          return okReply(COMPLETE);
        },
      },
      rpcs: {
        calendar_is_known_timezone: () => errReply("connection reset"),
        calendar_persist_version: () => okReply({ version_no: 7, validator_result: "accepted" }),
      },
    });
    client = failing;

    const result = await upsertStudyProfile(STUDENT, {
      timezone: "Asia/Tokyo",
      idempotency_key: KEY,
    });

    expect(result.ok).toBe(true);
    expect(storedRow().timezone).toBe("America/Chicago");
  });

  it("supplies the fallback zone on a create that names none at all", async () => {
    scenario({ existing: null });

    await upsertStudyProfile(STUDENT, {
      study_days_mask: 62,
      daily_minutes: 60,
      idempotency_key: KEY,
    });

    expect(storedRow().timezone).toBe("America/Chicago");
  });
});

describe("§8.1 bounds come from config", () => {
  it("refuses a daily_minutes that is not one of the offered presets", async () => {
    scenario({ existing: COMPLETE });

    const result = await upsertStudyProfile(STUDENT, {
      daily_minutes: 37,
      idempotency_key: KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid");
    expect(stored).toBeNull();
  });

  it("accepts a preset", async () => {
    scenario({ existing: COMPLETE });

    const result = await upsertStudyProfile(STUDENT, {
      daily_minutes: 90,
      idempotency_key: KEY,
    });

    expect(result.ok).toBe(true);
    expect(storedRow().daily_minutes).toBe(90);
  });

  it("refuses a body that changes nothing", async () => {
    scenario({ existing: COMPLETE });

    const result = await upsertStudyProfile(STUDENT, { idempotency_key: KEY });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid");
  });
});

describe("a create needs the inputs R-08-03 says the student states", () => {
  it("refuses a create with no study days and no daily minutes", async () => {
    scenario({ existing: null });

    const result = await upsertStudyProfile(STUDENT, {
      timezone: "Asia/Tokyo",
      idempotency_key: KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("incomplete");
    if (result.error.kind !== "incomplete") return;
    expect([...result.error.missing].sort()).toEqual(["daily_minutes", "study_days_mask"]);
  });

  it("does not invent a default for either of them", async () => {
    scenario({ existing: null });

    await upsertStudyProfile(STUDENT, {
      timezone: "Asia/Tokyo",
      idempotency_key: KEY,
    });

    expect(stored).toBeNull();
  });
});

describe("setup_completed_at is derived, never sent", () => {
  it("is stamped by the write that first gives the row a target score", async () => {
    scenario({ existing: { ...COMPLETE, target_score: null, setup_completed_at: null } });

    await upsertStudyProfile(STUDENT, { target_score: 1400, idempotency_key: KEY });

    expect(typeof storedRow().setup_completed_at).toBe("string");
  });

  it("is not re-stamped once setup is already complete", async () => {
    scenario({ existing: COMPLETE });

    await upsertStudyProfile(STUDENT, { target_score: 1500, idempotency_key: KEY });

    expect(storedRow().setup_completed_at).toBeUndefined();
  });

  // INVERTED 2026-09-24 (SCL-130, R-08-17 reversed). This asserted that setup stayed
  // incomplete until a target score arrived. Nothing in setup is required now, so the
  // opposite is the rule: reaching the end of the flow completes it, whatever was
  // answered. Leaving the old assertion would strand every student who skips the field —
  // no stamp, so the read keeps answering `setup_required` and the popup reopens forever.
  it("IS stamped by the first write, with no target score anywhere in it", async () => {
    scenario({ existing: { ...COMPLETE, target_score: null, setup_completed_at: null } });

    await upsertStudyProfile(STUDENT, { daily_minutes: 45, idempotency_key: KEY });

    expect(storedRow().setup_completed_at).toEqual(expect.any(String));
  });
});

describe("§12.1 profile_change", () => {
  it("regenerates for an auto student whose setup is complete, and returns the version", async () => {
    scenario({ existing: COMPLETE });

    const result = await upsertStudyProfile(STUDENT, {
      daily_minutes: 45,
      idempotency_key: KEY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version_no).toBe(7);

    const persist = client.rpcs.find((call) => call.fn === "calendar_persist_version");
    expect(persist?.args.p_trigger).toBe("profile_change");
    expect(persist?.args.p_initiated_by).toBe("student");
    expect(persist?.args.p_idempotency_key).toBe(KEY);
    // The generator version comes from config, never a literal in the server.
    expect(persist?.args.p_generator_version).toBe("20260917140000");
  });

  it("does NOT regenerate a student who turned the auto planner off", async () => {
    scenario({ existing: { ...COMPLETE, planner_mode: "custom" } });

    const result = await upsertStudyProfile(STUDENT, {
      daily_minutes: 45,
      idempotency_key: KEY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version_no).toBeUndefined();
    expect(client.rpcs.some((call) => call.fn === "calendar_persist_version")).toBe(false);
  });

  it("does NOT regenerate before setup completes — R-08-04 puts that on first open", async () => {
    scenario({ existing: { ...COMPLETE, target_score: null, setup_completed_at: null } });

    await upsertStudyProfile(STUDENT, { daily_minutes: 45, idempotency_key: KEY });

    expect(client.rpcs.some((call) => call.fn === "calendar_persist_version")).toBe(false);
  });

  it("keeps the saved profile when the regeneration fails — the setting IS saved", async () => {
    scenario({ existing: COMPLETE, persistFails: true });

    const result = await upsertStudyProfile(STUDENT, {
      daily_minutes: 45,
      idempotency_key: KEY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version_no).toBeUndefined();
    expect(result.value.profile.daily_minutes).toBe(45);
  });
});
