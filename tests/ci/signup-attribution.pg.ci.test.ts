/**
 * The sign-up channel against real Postgres: the server's one writer and the database's guard.
 *
 * @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
 *       2026-10-28) item 2 ("first touch only, allowlisted values, no raw URL"); Public Disclosure
 *       Doctrine rule 7 (under-13 excluded)] | @implemented [2026-10-28]
 *
 * plain English: `recordSignupAttribution` writes the channel and campaign once, on an account
 * that has not onboarded; the trigger `profiles_zz_signup_attribution` makes a stored value
 * permanent and never lets an under-13 profile hold one, whatever path writes it.
 */
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

let pg: Client;
const warned: string[] = [];

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/middleware/supabase-auth")
  >()),
  getSupabaseAdmin: () => makePgSupabase(pg),
}));
vi.mock("../../server/logger", () => ({
  logger: {
    info: () => undefined,
    debug: () => undefined,
    error: () => undefined,
    warn: (_c: string, event: string) => {
      warned.push(event);
    },
  },
}));

const DB = "signup_attribution_ci";
let n = 0;

async function account(opts: { onboarded?: boolean; dob?: string } = {}) {
  n += 1;
  const id = `5c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    id,
    `sa${n}@school.example`,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
     VALUES ($1, $2, 'student', 'Sam Lee', $3::date, $4::timestamptz)`,
    [
      id,
      `sa${n}@school.example`,
      opts.dob ?? null,
      opts.onboarded === true ? "2026-09-01T00:00:00Z" : null,
    ],
  );
  return id;
}

async function stored(id: string) {
  const r = await pg.query<{
    signup_channel: string | null;
    signup_campaign: string | null;
  }>(
    `SELECT signup_channel, signup_campaign FROM public.profiles WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

describe.skipIf(!PG_AVAILABLE)("sign-up channel → real PG", () => {
  let record: typeof import("../../server/lib/signup-attribution").recordSignupAttribution;

  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB);
    record = (await import("../../server/lib/signup-attribution"))
      .recordSignupAttribution;
  }, 300_000);

  afterAll(async () => {
    await pg?.end();
  });

  it("R1 a new account records its channel and campaign", async () => {
    const id = await account();
    // Presence before absence: nothing yet.
    expect(await stored(id)).toEqual({
      signup_channel: null,
      signup_campaign: null,
    });
    await record(id, { channel: "reddit", campaign: "qotd" }, "req");
    expect(await stored(id)).toEqual({
      signup_channel: "reddit",
      signup_campaign: "qotd",
    });
  });

  it("R2 first touch only: a second sign-in records nothing over it", async () => {
    const id = await account();
    await record(id, { channel: "tiktok", campaign: null }, "req");
    await record(id, { channel: "email", campaign: "dec_cohort" }, "req");
    expect(await stored(id)).toEqual({
      signup_channel: "tiktok",
      signup_campaign: null,
    });
  });

  it("R3 an onboarded account is never written", async () => {
    const id = await account({ onboarded: true });
    await record(id, { channel: "reddit", campaign: "qotd" }, "req");
    expect(await stored(id)).toEqual({
      signup_channel: null,
      signup_campaign: null,
    });
  });

  it("R4 allowlisted values only: an unknown channel writes nothing; an unknown campaign is null", async () => {
    const a = await account();
    await record(
      a,
      { channel: "https://reddit.com/r/sat", campaign: "qotd" },
      "r",
    );
    expect(await stored(a)).toEqual({
      signup_channel: null,
      signup_campaign: null,
    });
    const b = await account();
    await record(b, { channel: "instagram", campaign: "spring_promo" }, "r");
    expect(await stored(b)).toEqual({
      signup_channel: "instagram",
      signup_campaign: null,
    });
  });

  it("R5 the database: a stored channel or campaign cannot be changed or removed", async () => {
    const id = await account();
    await record(id, { channel: "facebook", campaign: "dec_cohort" }, "req");
    for (const sql of [
      `UPDATE public.profiles SET signup_channel = 'email' WHERE id = $1`,
      `UPDATE public.profiles SET signup_channel = NULL WHERE id = $1`,
      `UPDATE public.profiles SET signup_campaign = 'qotd' WHERE id = $1`,
    ]) {
      await expect(pg.query(sql, [id]), sql).rejects.toThrow(/set once/);
    }
    expect(await stored(id)).toEqual({
      signup_channel: "facebook",
      signup_campaign: "dec_cohort",
    });
    // The shape check: no URL or free text.
    const c = await account();
    await expect(
      pg.query(
        `UPDATE public.profiles SET signup_campaign = 'https://x.example/?a=b' WHERE id = $1`,
        [c],
      ),
    ).rejects.toThrow(/signup_campaign_check/);
  });

  it("R6 under 13: the values are cleared when the age is known, and never stored after", async () => {
    const id = await account();
    await record(id, { channel: "tiktok", campaign: "qotd" }, "req");
    expect((await stored(id))?.signup_channel).toBe("tiktok");
    // Onboarding writes the date of birth: an under-13 profile holds neither value.
    await pg.query(
      `UPDATE public.profiles SET date_of_birth = '2016-03-01' WHERE id = $1`,
      [id],
    );
    expect(await stored(id)).toEqual({
      signup_channel: null,
      signup_campaign: null,
    });
    const young = await account({ dob: "2016-03-01" });
    await pg.query(
      `UPDATE public.profiles SET signup_channel = 'reddit', signup_campaign = 'qotd' WHERE id = $1`,
      [young],
    );
    expect(await stored(young)).toEqual({
      signup_channel: null,
      signup_campaign: null,
    });
    // A 13+ birth date keeps them.
    const teen = await account();
    await record(teen, { channel: "reddit", campaign: null }, "req");
    await pg.query(
      `UPDATE public.profiles SET date_of_birth = '2010-03-01' WHERE id = $1`,
      [teen],
    );
    expect((await stored(teen))?.signup_channel).toBe("reddit");
  });
});
