/**
 * @spec [Doc-01 §40.2 step 4 and §40.2.1 Phase 3, as amended by SCL-190; register F-32; owner
 *        ruling Brief 6] | @implemented [2026-09-30] |
 * plain English: requesting account deletion revokes every session the account holds, by calling
 * `auth.admin.signOut(<the request's own access token>, 'global')` exactly once, on a REAL
 * supabase-js admin client. The real client is the point: the defect this replaces called
 * `auth.admin.signOutUser`, which the real client does not have, and the only test around it gave
 * a hand-built mock that method. `vi.spyOn` on a method the real client lacks throws, so this
 * file cannot be satisfied by an invented method.
 *
 * The route runs end to end (router → V2 path → revoke) with only its seams replaced: the auth
 * middleware attaches the user and the request's SSR client, CSRF passes, the grace-days reader
 * and the confirmation email are stubbed, and the database calls on the real admin client are
 * spied. No network is touched.
 *
 * Failure: if the revoke fails, the request still succeeds (the deletion is already committed),
 * and one ERROR line is written with the event name and request id only.
 */
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "7f3c2a10-1111-4222-8333-444455556666";
const ACCESS_TOKEN = "header.payload-for-revoke-test.signature";
const REQUEST_ID = "req-revoke-1";

const seams = vi.hoisted(() => ({
  admin: null as unknown,
  sessionClient: null as unknown,
}));

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../server/middleware/supabase-auth")
    >();
  return {
    ...actual,
    getSupabaseAdmin: () => seams.admin,
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.user = {
        id: USER_ID,
        email: "revoke-test@example.test",
        display_name: null,
        role: "student",
        isAdmin: false,
        isGuardian: false,
        actor_id: "actor-revoke-1",
      };
      req.supabase = seams.sessionClient as SupabaseClient;
      next();
    },
  };
});

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

vi.mock(
  "../../server/lib/account-deletion-runtime-config",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../server/lib/account-deletion-runtime-config")
      >();
    return { ...actual, getDeletionGraceDays: async () => 7 };
  },
);

vi.mock(
  "../../server/lib/notifications/direct-sends",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../server/lib/notifications/direct-sends")
      >();
    return {
      ...actual,
      sendAccountDeletionScheduledEmail: vi.fn(async () => ({
        ok: true,
        value: { providerMessageId: "msg-1" },
      })),
    };
  },
);

const { default: accountDeletionRoutes } =
  await import("../../server/routes/account-deletion-routes");
const { logger } = await import("../../server/logger");

function realClient(): SupabaseClient {
  return createClient("http://127.0.0.1:1", "test-key-not-used", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A PostgREST-shaped `from()` for the one lookup the V2 path makes (the request row id). */
function requestRowLookup() {
  return {
    select: () => ({
      eq: () => ({
        limit: async () => ({ data: [{ id: "deletion-row-1" }], error: null }),
      }),
    }),
  };
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.requestId = REQUEST_ID;
    next();
  });
  app.use("/api/account", accountDeletionRoutes);
  return app;
}

describe("deletion request revokes every session (F-32, SCL-190)", () => {
  const previousFlag = process.env.ACCOUNT_DELETION_LIFECYCLE_V2;
  let admin: SupabaseClient;
  let signOut: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
    admin = realClient();
    const sessionClient = realClient();
    vi.spyOn(sessionClient.auth, "getSession").mockResolvedValue({
      data: { session: { access_token: ACCESS_TOKEN } },
      error: null,
    } as unknown as Awaited<ReturnType<SupabaseClient["auth"]["getSession"]>>);
    vi.spyOn(admin, "rpc").mockResolvedValue({
      data: [
        {
          requested_at: "2026-09-30T00:00:00.000Z",
          scheduled_hard_delete_at: "2026-10-07T00:00:00.000Z",
        },
      ],
      error: null,
    } as unknown as Awaited<ReturnType<SupabaseClient["rpc"]>>);
    vi.spyOn(admin, "from").mockReturnValue(
      requestRowLookup() as unknown as ReturnType<SupabaseClient["from"]>,
    );
    vi.spyOn(admin.auth.admin, "getUserById").mockResolvedValue({
      data: { user: { id: USER_ID, email: "revoke-test@example.test" } },
      error: null,
    } as unknown as Awaited<
      ReturnType<SupabaseClient["auth"]["admin"]["getUserById"]>
    >);
    // A spy on the REAL client's method: this line throws if `signOut` is not a real method.
    signOut = vi.spyOn(admin.auth.admin, "signOut");
    seams.admin = admin;
    seams.sessionClient = sessionClient;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousFlag === undefined)
      delete process.env.ACCOUNT_DELETION_LIFECYCLE_V2;
    else process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = previousFlag;
  });

  it("calls auth.admin.signOut(<request access token>, 'global') exactly once", async () => {
    signOut.mockResolvedValue({ data: null, error: null });
    const errors = vi.spyOn(logger, "error");

    const res = await request(makeApp()).post("/api/account/delete").send({});

    // Presence first: the V2 path ran and scheduled the deletion.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(ACCESS_TOKEN, "global");
    expect(
      errors.mock.calls.filter(
        (call) => call[1] === "signout_best_effort_failed",
      ),
    ).toHaveLength(0);
  });

  it("a failed revoke still succeeds, and logs one ERROR with the event name and request id only", async () => {
    signOut.mockRejectedValue(new Error(`revoke failed for ${USER_ID}`));
    const errors = vi.spyOn(logger, "error");

    const res = await request(makeApp()).post("/api/account/delete").send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
    const revokeLines = errors.mock.calls.filter(
      (call) => call[1] === "signout_best_effort_failed",
    );
    expect(revokeLines).toHaveLength(1);
    const [component, operation, message, error, data] = revokeLines[0] ?? [];
    expect(component).toBe("DELETION");
    expect(operation).toBe("signout_best_effort_failed");
    expect(typeof message).toBe("string");
    expect(error).toBeUndefined();
    expect(data).toEqual({ requestId: REQUEST_ID });
    // No person field, token or provider message anywhere on the line.
    const line = JSON.stringify(revokeLines[0]);
    expect(line).not.toContain(USER_ID);
    expect(line).not.toContain(ACCESS_TOKEN);
    expect(line).not.toContain("revoke-test@");
  });

  it("an error result from signOut (not a throw) is handled the same way", async () => {
    signOut.mockResolvedValue({
      data: null,
      error: new Error("session_not_found"),
    } as unknown as Awaited<
      ReturnType<SupabaseClient["auth"]["admin"]["signOut"]>
    >);
    const errors = vi.spyOn(logger, "error");

    const res = await request(makeApp()).post("/api/account/delete").send({});

    expect(res.status).toBe(200);
    expect(
      errors.mock.calls.filter(
        (call) => call[1] === "signout_best_effort_failed",
      ),
    ).toHaveLength(1);
  });
});
