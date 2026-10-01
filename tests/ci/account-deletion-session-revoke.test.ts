/**
 * @spec [Doc-01 §40.2 step 4 and §40.2.1 Phase 3, as amended by SCL-190; register F-32; owner
 *        ruling Brief 6] | @implemented [2026-09-30] |
 * plain English: requesting account deletion revokes every OTHER session the account holds, by
 * calling `auth.admin.signOut(<the request's own access token>, 'others')` exactly once, on a REAL
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
 *
 * Scope (owner ruling 2026-10-01, register F-44, SCL-190 amended): `'others'`, not `'global'`. The
 * requester keeps its session, so the product's reload shows the pending-deletion screen instead of
 * `/login`; every other session is revoked; the kept session is confined by the pending-deletion
 * gate. The "which sessions survive" case drives the REAL auth-js `signOut` against a stand-in for
 * GoTrue's `POST /logout?scope=` (global: every session of the user; others: every session except
 * the caller's; local: the caller's only), so it pins both the scope and the request auth-js sends.
 */
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
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
    requireSupabaseAuth: (req: Request, _res: ExpressResponse, next: NextFunction) => {
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
  doubleCsrfProtection: (_req: Request, _res: ExpressResponse, next: NextFunction) =>
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
const authModule = await import("../../server/middleware/supabase-auth");

function realClient(fetchImpl?: typeof fetch): SupabaseClient {
  return createClient("http://127.0.0.1:1", "test-key-not-used", {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
}

/** The database calls the V2 path makes on the admin client, stubbed; auth calls stay real. */
function wireAdmin(client: SupabaseClient): void {
  vi.spyOn(client, "rpc").mockResolvedValue({
    data: [
      {
        requested_at: "2026-09-30T00:00:00.000Z",
        scheduled_hard_delete_at: "2026-10-07T00:00:00.000Z",
      },
    ],
    error: null,
  } as unknown as Awaited<ReturnType<SupabaseClient["rpc"]>>);
  vi.spyOn(client, "from").mockReturnValue(
    requestRowLookup() as unknown as ReturnType<SupabaseClient["from"]>,
  );
  vi.spyOn(client.auth.admin, "getUserById").mockResolvedValue({
    data: { user: { id: USER_ID, email: "revoke-test@example.test" } },
    error: null,
  } as unknown as Awaited<
    ReturnType<SupabaseClient["auth"]["admin"]["getUserById"]>
  >);
}

const OTHER_DEVICE_TOKEN = "header.payload-other-device.signature";
const OTHER_USER_TOKEN = "header.payload-other-user.signature";

/**
 * A stand-in for GoTrue's `POST /auth/v1/logout?scope=` as Supabase documents it: `global` revokes
 * every session of the caller's user, `others` every session except the caller's, `local` the
 * caller's only. Any other request fails loudly, so nothing reaches a network.
 */
function goTrueLogoutStandIn() {
  const sessions = new Map<string, { user: string; revoked: boolean }>([
    [ACCESS_TOKEN, { user: USER_ID, revoked: false }],
    [OTHER_DEVICE_TOKEN, { user: USER_ID, revoked: false }],
    [OTHER_USER_TOKEN, { user: "someone-else", revoked: false }],
  ]);
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const bearer = new Headers(init?.headers)
      .get("authorization")
      ?.replace(/^Bearer /, "");
    calls.push(`${method} ${url.pathname}?${url.searchParams.toString()}`);
    if (method !== "POST" || url.pathname !== "/auth/v1/logout") {
      throw new Error(`unexpected request ${method} ${url.pathname}`);
    }
    const caller = bearer ? sessions.get(bearer) : undefined;
    if (!caller) return new Response(null, { status: 401 });
    const scope = url.searchParams.get("scope");
    for (const [token, row] of sessions) {
      if (row.user !== caller.user) continue;
      const isCaller = token === bearer;
      if (
        scope === "global" ||
        (scope === "others" && !isCaller) ||
        (scope === "local" && isCaller)
      ) {
        row.revoked = true;
      }
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const valid = (token: string): boolean =>
    sessions.get(token)?.revoked === false;
  return { fetchImpl, calls, valid };
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
    wireAdmin(admin);
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
    authModule.setDeletionStatusResolverForTests(null);
  });

  it("keeps the requesting session and revokes every other session of the same user (F-44)", async () => {
    const goTrue = goTrueLogoutStandIn();
    const realAdmin = realClient(goTrue.fetchImpl);
    wireAdmin(realAdmin);
    seams.admin = realAdmin;
    // Presence: all three sessions are live before the request.
    expect(
      [ACCESS_TOKEN, OTHER_DEVICE_TOKEN, OTHER_USER_TOKEN].map(goTrue.valid),
    ).toEqual([true, true, true]);

    const res = await request(makeApp()).post("/api/account/delete").send({});

    expect(res.status).toBe(200);
    // The one request the real auth-js client sent: scope `others`, carrying the request's token.
    expect(goTrue.calls).toEqual(["POST /auth/v1/logout?scope=others"]);
    expect(goTrue.valid(ACCESS_TOKEN)).toBe(true);
    expect(goTrue.valid(OTHER_DEVICE_TOKEN)).toBe(false);
    expect(goTrue.valid(OTHER_USER_TOKEN)).toBe(true);
  });

  it("the kept session is held by the pending-deletion gate: the pending screen's calls pass, the rest is refused", async () => {
    authModule.setDeletionStatusResolverForTests(async () => ({
      status: "pending_deletion",
      executedAt: new Date().toISOString(),
    }));
    const gate = async (method: string, path: string) => {
      const req = {
        user: { id: USER_ID },
        requestId: REQUEST_ID,
        method,
        path,
      } as unknown as Request;
      const out: { status?: number; body?: unknown; next: boolean } = {
        next: false,
      };
      const res = {
        status(code: number) {
          out.status = code;
          return res;
        },
        json(body: unknown) {
          out.body = body;
          return res;
        },
      } as unknown as ExpressResponse;
      await authModule.enforceDeletionLock(req, res, () => {
        out.next = true;
      });
      return out;
    };
    // PendingDeletionScreen's only two calls.
    expect((await gate("GET", "/api/profile")).next).toBe(true);
    expect((await gate("POST", "/api/account/cancel-deletion")).next).toBe(
      true,
    );
    // Everything else the app would call is refused.
    for (const [method, path] of [
      ["GET", "/api/progress/kpis"],
      ["GET", "/api/practice/sessions/open"],
      ["PATCH", "/api/profile"],
    ] as const) {
      const out = await gate(method, path);
      expect(out.next, `${method} ${path}`).toBe(false);
      expect(out.status).toBe(403);
      expect(out.body).toMatchObject({ code: "PENDING_DELETION" });
    }
  });

  it("calls auth.admin.signOut(<request access token>, 'others') exactly once", async () => {
    signOut.mockResolvedValue({ data: null, error: null });
    const errors = vi.spyOn(logger, "error");

    const res = await request(makeApp()).post("/api/account/delete").send({});

    // Presence first: the V2 path ran and scheduled the deletion.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(ACCESS_TOKEN, "others");
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
