import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ensureProfileForAuthUser,
  AccountEmailConflictError,
} from "../../server/lib/profile-bootstrap";

/**
 * @spec [contracts/auth-login-e2e.contract.md AL-7 | Doc-01_V6 §7 Identity / profile-per-human]
 * Proof that one human resolves to exactly one profile across providers (same email, second
 * provider) regardless of the Supabase identity-linking dashboard toggle — the config-agnostic
 * guard. Never asserts on dashboard state; exercises the bootstrap directly with a mocked admin
 * client so the invariant is proven deterministically with no live backend.
 */

type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  is_under_13: boolean;
  guardian_consent: boolean;
  guardian_email: string | null;
  student_link_code: string | null;
  profile_completed_at: string | null;
};

type SbResult<T> = Promise<{
  data: T | null;
  error: { code?: string; message: string } | null;
}>;

type MockAdminOptions = {
  existingById?: ProfileRow | null;
  existingByEmail?: { id: string } | null;
  insertResult?: {
    data: ProfileRow | null;
    error: { code?: string; message: string } | null;
  };
};

const insertSpy = vi.fn();

function makeAdmin(opts: MockAdminOptions): SupabaseClient {
  insertSpy.mockClear();

  const from = (table: string) => {
    if (table !== "profiles") {
      throw new Error(`Unexpected table in test: ${table}`);
    }

    return {
      // Two read shapes: by-id (no .neq) and by-email (uses .neq('id', …)). We distinguish on
      // whether .neq was called, mirroring ensureProfileForAuthUser's two lookups exactly.
      select: () => {
        let neqUsed = false;
        const builder = {
          eq: () => builder,
          neq: () => {
            neqUsed = true;
            return builder;
          },
          maybeSingle: (): SbResult<ProfileRow | { id: string }> =>
            Promise.resolve(
              neqUsed
                ? { data: opts.existingByEmail ?? null, error: null }
                : { data: opts.existingById ?? null, error: null },
            ),
          // .insert(...).select(...).single() path
          single: (): SbResult<ProfileRow> =>
            Promise.resolve(opts.insertResult ?? { data: null, error: null }),
        };
        return builder;
      },
      insert: (row: unknown) => {
        insertSpy(row);
        return {
          select: () => ({
            single: (): SbResult<ProfileRow> =>
              Promise.resolve(opts.insertResult ?? { data: null, error: null }),
          }),
        };
      },
    };
  };

  return { from } as unknown as SupabaseClient;
}

function makeUser(id: string, email: string): User {
  return {
    id,
    email,
    user_metadata: {},
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-06-17T00:00:00Z",
  } as unknown as User;
}

const ctx = { source: "google_oauth_callback" as const, requestId: "test-req" };

describe("Account linking — profile-per-human (AL-7)", () => {
  it("returns the existing profile for the same auth id (idempotent bootstrap, no insert)", async () => {
    const existing: ProfileRow = {
      id: "user-1",
      email: "a@example.com",
      display_name: "A",
      role: "student",
      is_under_13: false,
      guardian_consent: false,
      guardian_email: null,
      student_link_code: null,
      profile_completed_at: null,
    };
    const admin = makeAdmin({ existingById: existing });

    const result = await ensureProfileForAuthUser(
      admin,
      makeUser("user-1", "a@example.com"),
      ctx,
    );

    expect(result.id).toBe("user-1");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("blocks a second provider on the same email under a DIFFERENT auth id (no duplicate profile)", async () => {
    // Same human, second provider, identity-linking NOT merging → a new auth id for an email that
    // already anchors a profile. Must surface a deliberate conflict, never a second profile.
    const admin = makeAdmin({
      existingById: null,
      existingByEmail: { id: "user-1" },
    });

    await expect(
      ensureProfileForAuthUser(admin, makeUser("user-2", "a@example.com"), ctx),
    ).rejects.toBeInstanceOf(AccountEmailConflictError);

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("translates the unique-index 23505 race into the same deliberate conflict (DB backstop)", async () => {
    const admin = makeAdmin({
      existingById: null,
      existingByEmail: null, // pre-check passes; the index catches the race
      insertResult: {
        data: null,
        error: { code: "23505", message: "duplicate key value" },
      },
    });

    await expect(
      ensureProfileForAuthUser(admin, makeUser("user-3", "a@example.com"), ctx),
    ).rejects.toBeInstanceOf(AccountEmailConflictError);

    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("creates a new profile when the email is free", async () => {
    const created: ProfileRow = {
      id: "user-4",
      email: "fresh@example.com",
      display_name: null,
      role: "student",
      is_under_13: false,
      guardian_consent: false,
      guardian_email: null,
      student_link_code: null,
      profile_completed_at: null,
    };
    const admin = makeAdmin({
      existingById: null,
      existingByEmail: null,
      insertResult: { data: created, error: null },
    });

    const result = await ensureProfileForAuthUser(
      admin,
      makeUser("user-4", "fresh@example.com"),
      ctx,
    );

    expect(result.id).toBe("user-4");
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
