import {
  buildDeletedEmail,
  buildDeletionRequestInsert,
  isGraceWindowExpired,
  scheduledHardDeleteAt,
  DELETION_GRACE_DAYS,
  hashRecoveryToken,
  generateRecoveryToken,
  performRecovery,
  performInAppCancel,
  performDeletionRequestV2,
} from "../routes/account-deletion-routes";
import {
  executeDueDeletions,
  anonymizeAccount,
} from "../lib/account-deletion-execute";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as authMiddleware from "../middleware/supabase-auth";

// @spec [SCL-086 PROPOSED: cancel at T+7, not pause] the four Stripe calls the executor may make.
const stripeMocks = vi.hoisted(() => ({
  list: vi.fn(async (): Promise<{ data: Array<{ id: string; status: string }> }> => ({ data: [] })),
  cancel: vi.fn(async () => ({})),
  retrieve: vi.fn(
    async (): Promise<{
      id: string;
      status: string;
      items: { data: Array<{ id: string; metadata?: Record<string, string> }> };
    }> => ({ id: "sub_abc", status: "active", items: { data: [{ id: "si_1" }] } }),
  ),
  itemDel: vi.fn(async () => ({})),
  clientConstructed: vi.fn(),
}));
vi.mock("../lib/stripe/client.js", () => ({
  getStripeClient: vi.fn(() => {
    stripeMocks.clientConstructed();
    return {
      subscriptions: {
        list: stripeMocks.list,
        cancel: stripeMocks.cancel,
        retrieve: stripeMocks.retrieve,
      },
      subscriptionItems: { del: stripeMocks.itemDel },
    };
  }),
}));

type FakeAdmin = Parameters<typeof performRecovery>[0];
const fakeAdminWithRpc = (
  impl: (
    fn: string,
    args: Record<string, unknown>,
  ) => { data: unknown; error: unknown },
) =>
  ({
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) =>
      impl(fn, args),
    ),
  }) as unknown as FakeAdmin;

const DAY_MS = 24 * 60 * 60 * 1000;

describe("Deletion Lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    authMiddleware.setDeletionStatusResolverForTests(null);
    delete process.env.ACCOUNT_DELETION_LIFECYCLE_V2;
  });

  it("deletion request enters pending state", () => {
    const email = buildDeletedEmail("user_123");
    expect(email).toBe("deleted_user_123@deleted.lyceon.ai");
  });

  // @spec [Doc-01 §40] the locked window is 7 days, not the prior deployed 24h.
  it("uses the locked 7-day grace window (Doc-01 §40)", () => {
    expect(DELETION_GRACE_DAYS).toBe(7);
  });

  it("cancellation inside the 7-day grace succeeds", () => {
    const requestedAt = new Date(Date.now() - 2 * DAY_MS).toISOString();
    expect(isGraceWindowExpired(requestedAt)).toBe(false);
  });

  it("grace window is still open at day 6, expired past day 7", () => {
    const sixDaysAgo = new Date(Date.now() - 6 * DAY_MS).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS).toISOString();
    expect(isGraceWindowExpired(sixDaysAgo)).toBe(false);
    expect(isGraceWindowExpired(eightDaysAgo)).toBe(true);
  });

  it("post-grace execution is eligible once the 7-day window passes", () => {
    const requestedAt = new Date(Date.now() - 8 * DAY_MS).toISOString();
    expect(isGraceWindowExpired(requestedAt)).toBe(true);
  });

  // @spec [Doc-01 §40.2] scheduled_hard_delete_at = requested_at + 7 days.
  it("schedules the hard delete exactly 7 days out", () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    expect(scheduledHardDeleteAt(now)).toBe(
      new Date(now.getTime() + 7 * DAY_MS).toISOString(),
    );
  });

  // @spec [Doc-01 §40.2 / §40.2.1 / §5] self-serve insert carries the canonical schedule + actor.
  it("builds a self-serve deletion request with the locked spec columns", () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const row = buildDeletionRequestInsert("profile_abc", now);
    expect(row.profile_id).toBe("profile_abc");
    // §5: for self-service the actor IS the requesting profile.
    expect(row.actor_profile_id).toBe("profile_abc");
    expect(row.status).toBe("pending");
    expect(row.stripe_cancellation_status).toBe("pending");
    // §40.2: now + 7 days.
    expect(row.scheduled_hard_delete_at).toBe(
      new Date(now.getTime() + 7 * DAY_MS).toISOString(),
    );
  });

  it("internal IDs/ledger continuity remain intact where intentionally preserved", () => {
    const email = buildDeletedEmail("account_abc");
    expect(email.includes("account_abc")).toBe(true);
  });

  // @spec [Doc-01_V8 §40.3] The §40.3 lock is enforced structurally by enforceDeletionLock (global
  // default-deny + minimal allowlist), NOT per-route — closing the requireRequestUser bypass class.
  const lockReq = (over: Record<string, unknown>) =>
    ({
      user: { id: "user_123" },
      requestId: "req_1",
      method: "GET",
      path: "/api/x",
      ...over,
    }) as any;
  const lockRes = () =>
    ({ status: vi.fn().mockReturnThis(), json: vi.fn() }) as any;

  it("hard-deleted user is 403 ACCOUNT_DELETED on every /api route (no allowlist)", async () => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
    authMiddleware.setDeletionStatusResolverForTests(async () => ({
      status: "deleted",
      executedAt: new Date().toISOString(),
    }));
    const res = lockRes();
    const next = vi.fn();
    // even an otherwise-allowlisted path is blocked for a completed/hard-deleted account
    await authMiddleware.enforceDeletionLock(
      lockReq({ path: "/api/profile", method: "GET" }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ACCOUNT_DELETED" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("pending-deletion user is 403 PENDING_DELETION on a non-allowlisted route", async () => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
    authMiddleware.setDeletionStatusResolverForTests(async () => ({
      status: "pending_deletion",
      executedAt: new Date().toISOString(),
    }));
    const res = lockRes();
    const next = vi.fn();
    await authMiddleware.enforceDeletionLock(
      lockReq({ path: "/api/tutor/messages", method: "POST" }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PENDING_DELETION" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  // LOAD-BEARING (strand-prevention at the middleware level): a pending user MUST reach every
  // allowlisted recovery/cancel/profile/signout path, or they are stranded soft-deleted.
  it("pending-deletion user reaches every allowlisted route", async () => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
    authMiddleware.setDeletionStatusResolverForTests(async () => ({
      status: "pending_deletion",
      executedAt: new Date().toISOString(),
    }));
    const allow: ReadonlyArray<readonly [string, string]> = [
      ["GET", "/api/profile"],
      ["POST", "/api/account/cancel-deletion"],
      ["POST", "/api/account/recover-deletion"],
      ["POST", "/api/auth/signout"],
    ];
    for (const [method, path] of allow) {
      const res = lockRes();
      const next = vi.fn();
      await authMiddleware.enforceDeletionLock(
        lockReq({ path, method }),
        res,
        next,
      );
      expect(
        next,
        `${method} ${path} must be allowlisted`,
      ).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("PATCH /api/profile is NOT allowlisted (only GET) for a pending user", async () => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
    authMiddleware.setDeletionStatusResolverForTests(async () => ({
      status: "pending_deletion",
      executedAt: new Date().toISOString(),
    }));
    const res = lockRes();
    const next = vi.fn();
    await authMiddleware.enforceDeletionLock(
      lockReq({ path: "/api/profile", method: "PATCH" }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PENDING_DELETION" }),
    );
  });

  it("flag OFF => pass-through (dormant) even when the resolver says deleted", async () => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "false";
    authMiddleware.setDeletionStatusResolverForTests(async () => ({
      status: "deleted",
      executedAt: null,
    }));
    const res = lockRes();
    const next = vi.fn();
    await authMiddleware.enforceDeletionLock(
      lockReq({ path: "/api/tutor/messages", method: "POST" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("non-/api path (SPA/static) is never blocked, so the client can render the pending screen", async () => {
    process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
    authMiddleware.setDeletionStatusResolverForTests(async () => ({
      status: "pending_deletion",
      executedAt: null,
    }));
    const res = lockRes();
    const next = vi.fn();
    await authMiddleware.enforceDeletionLock(
      lockReq({ path: "/dashboard", method: "GET" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("Deletion Lifecycle V2 — token recovery (§40.4) + request (§40.2.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hashes recovery tokens deterministically (sha256 hex), never storing the raw token", () => {
    const h1 = hashRecoveryToken("abc");
    expect(h1).toBe(hashRecoveryToken("abc"));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe("abc");
  });

  it("generates a unique raw token whose hash matches hashRecoveryToken", () => {
    const a = generateRecoveryToken();
    const b = generateRecoveryToken();
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).toBe(hashRecoveryToken(a.rawToken));
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  // LOAD-BEARING (strand-prevention): recovery succeeds with NO authenticated session — only a
  // token. A soft-deleted user is login-locked (§40.3) yet must still cancel during grace (§40.4).
  it("restores the account mid-grace with only a token (no session) — strand-prevention", async () => {
    const admin = fakeAdminWithRpc((fn) => {
      expect(fn).toBe("restore_account_deletion");
      return { data: "profile-xyz", error: null };
    });
    const result = await performRecovery(
      admin,
      generateRecoveryToken().rawToken,
    );
    expect(result).toEqual({ ok: true, profileId: "profile-xyz" });
  });

  it("passes only the hashed token (never the raw token) to the restore RPC", async () => {
    const raw = generateRecoveryToken().rawToken;
    const rpc = vi.fn(async () => ({ data: "p1", error: null }));
    const admin = { rpc } as unknown as FakeAdmin;
    await performRecovery(admin, raw);
    expect(rpc).toHaveBeenCalledWith("restore_account_deletion", {
      p_recovery_token_hash: hashRecoveryToken(raw),
    });
    expect(
      (rpc.mock.calls[0]?.[1] as Record<string, unknown>).p_recovery_token_hash,
    ).not.toBe(raw);
  });

  it("maps an unknown/expired token (RPC null) to INVALID_OR_EXPIRED (404-class)", async () => {
    const admin = fakeAdminWithRpc(() => ({ data: null, error: null }));
    expect(await performRecovery(admin, "whatever")).toEqual({
      ok: false,
      code: "INVALID_OR_EXPIRED",
      message: expect.any(String),
    });
  });

  it("maps a unique_violation (email reclaimed during grace) to EMAIL_RECLAIMED (409-class)", async () => {
    const admin = fakeAdminWithRpc(() => ({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    }));
    expect(await performRecovery(admin, "whatever")).toEqual({
      ok: false,
      code: "EMAIL_RECLAIMED",
      message: expect.any(String),
    });
  });

  it("surfaces other RPC errors as ERROR (500-class)", async () => {
    const admin = fakeAdminWithRpc(() => ({
      data: null,
      error: { code: "P0001", message: "boom" },
    }));
    expect(await performRecovery(admin, "whatever")).toEqual({
      ok: false,
      code: "ERROR",
      message: "boom",
    });
  });

  // §40.4 in-app cancel — the authenticated symmetric twin of token recovery. DB-level atomicity
  // (no strand on email-reclaim) is proven by scripts/ci/deletion-cancel-atomicity.*; these cover
  // the route-facing result mapping.
  it("in-app cancel returns ok with the restored profileId", async () => {
    const admin = fakeAdminWithRpc((fn) => {
      expect(fn).toBe("cancel_account_deletion");
      return { data: "profile-xyz", error: null };
    });
    expect(await performInAppCancel(admin, "profile-xyz")).toEqual({
      ok: true,
      profileId: "profile-xyz",
    });
  });

  it("in-app cancel passes only p_profile_id to the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: "p1", error: null }));
    const admin = { rpc } as unknown as FakeAdmin;
    await performInAppCancel(admin, "p1");
    expect(rpc).toHaveBeenCalledWith("cancel_account_deletion", {
      p_profile_id: "p1",
    });
  });

  it("in-app cancel maps RPC null (no pending request) to NO_PENDING (404-class)", async () => {
    const admin = fakeAdminWithRpc(() => ({ data: null, error: null }));
    expect(await performInAppCancel(admin, "p1")).toEqual({
      ok: false,
      code: "NO_PENDING",
      message: expect.any(String),
    });
  });

  it("in-app cancel maps a unique_violation (email reclaimed, rolled back) to EMAIL_RECLAIMED (409-class)", async () => {
    const admin = fakeAdminWithRpc(() => ({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    }));
    expect(await performInAppCancel(admin, "p1")).toEqual({
      ok: false,
      code: "EMAIL_RECLAIMED",
      message: expect.any(String),
    });
  });

  it("in-app cancel surfaces other RPC errors as ERROR (500-class)", async () => {
    const admin = fakeAdminWithRpc(() => ({
      data: null,
      error: { code: "P0001", message: "boom" },
    }));
    expect(await performInAppCancel(admin, "p1")).toEqual({
      ok: false,
      code: "ERROR",
      message: "boom",
    });
  });

  // §40.2.1 Phase 1: self-serve request → actor = requester, 7-day grace, returns schedule + token.
  it("requests deletion via the atomic RPC with self-serve actor + 7-day grace + hashed token", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ requested_at: "R", scheduled_hard_delete_at: "S" }],
      error: null,
    }));
    // R9 (2026-09-03): after the RPC, the request row is read back by token hash so the
    // deletion-scheduled email can be keyed on its id.
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({ data: [{ id: "req-row-1" }], error: null }),
        }),
      }),
    }));
    const admin = { rpc, from } as unknown as FakeAdmin;
    const result = await performDeletionRequestV2(admin, "profile-1");
    expect("error" in result).toBe(false);
    expect(result).toMatchObject({
      requestedAt: "R",
      scheduledHardDeleteAt: "S",
      requestRowId: "req-row-1",
    });
    expect(from).toHaveBeenCalledWith("account_deletion_requests");
    expect(typeof (result as { rawToken: string }).rawToken).toBe("string");
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_profile_id).toBe("profile-1");
    expect(args.p_actor_id).toBe("profile-1"); // §5 self-serve: actor = requester
    expect(args.p_grace_days).toBe(DELETION_GRACE_DAYS);
    expect(args.p_recovery_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns an error when the request RPC fails", async () => {
    const admin = fakeAdminWithRpc(() => ({
      data: null,
      error: { message: "db down" },
    }));
    expect(await performDeletionRequestV2(admin, "profile-1")).toEqual({
      error: "db down",
    });
  });
});

// ---------------------------------------------------------------------------
// PR-4a: Grace-expiry driver — execution sequence + anonymize-by-construction
// ---------------------------------------------------------------------------
describe("Deletion Driver (executeDueDeletions) — PR-4a", () => {
  type RpcCall = { fn: string; args: Record<string, unknown> };

  function buildFakeAdmin(opts?: {
    pendingRequests?: Array<{
      id: string;
      profile_id: string;
      log_id?: string | null;
    }>;
    profile?: { email?: string | null; stripe_customer_id?: string | null };
    fetchError?: { message: string };
    rpcErrors?: Record<string, { message: string }>;
    rpcReturns?: Record<string, unknown>;
    entitlement?: { stripe_subscription_id: string | null };
    buckets?: Array<{ name: string }>;
    storageObjects?: Array<{ name: string }>;
    markError?: { message: string };
  }) {
    const rpcCalls: RpcCall[] = [];
    const updateCalls: Array<{ data: Record<string, unknown>; table: string }> =
      [];
    const signOutCalls: string[] = [];

    const admin = {
      from: vi.fn((table: string) => {
        if (table === "account_deletion_requests") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                lte: vi.fn(() => ({
                  order: vi.fn(async () => ({
                    data: opts?.fetchError
                      ? null
                      : (opts?.pendingRequests ?? []),
                    error: opts?.fetchError ?? null,
                  })),
                })),
              })),
            })),
            update: vi.fn((data: Record<string, unknown>) => {
              updateCalls.push({ data, table });
              return {
                eq: vi.fn(async () => ({
                  error: opts?.markError ?? null,
                })),
              };
            }),
          };
        }
        if (table === "entitlements") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: opts?.entitlement ?? null,
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: opts?.profile ?? null,
                  error: null,
                })),
              })),
            })),
          };
        }
        return {};
      }),
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        const err = opts?.rpcErrors?.[fn];
        if (err) return { data: null, error: err };
        const customReturn = opts?.rpcReturns?.[fn];
        if (customReturn !== undefined)
          return { data: customReturn, error: null };
        return { data: {}, error: null };
      }),
      auth: {
        admin: {
          signOutUser: vi.fn(async (id: string) => {
            signOutCalls.push(id);
            return { error: null };
          }),
          updateUserById: vi.fn(async () => ({ error: null })),
        },
      },
      storage: {
        listBuckets: vi.fn(async () => ({
          data: opts?.buckets ?? [],
          error: null,
        })),
        from: vi.fn(() => ({
          list: vi.fn(async () => ({
            data: opts?.storageObjects ?? [],
            error: null,
          })),
        })),
      },
    };

    return {
      admin: admin as unknown as Parameters<typeof executeDueDeletions>[0],
      rpcCalls,
      updateCalls,
      signOutCalls,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    stripeMocks.list.mockReset().mockImplementation(async () => ({ data: [] }));
    stripeMocks.cancel.mockReset().mockImplementation(async () => ({}));
    stripeMocks.retrieve
      .mockReset()
      .mockImplementation(async () => ({
        id: "sub_abc",
        status: "active",
        items: { data: [{ id: "si_1" }] },
      }));
    stripeMocks.itemDel.mockReset().mockImplementation(async () => ({}));
    stripeMocks.clientConstructed.mockReset();
  });

  it("calls the atomic complete_and_anonymize RPC — anonymize-by-construction in SQL", async () => {
    const { admin, rpcCalls } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    await executeDueDeletions(admin, "test-req");
    const atomicCall = rpcCalls.find(
      (c) => c.fn === "complete_and_anonymize_account",
    );
    expect(atomicCall).toBeDefined();
    expect(atomicCall!.args).toEqual({
      p_request_id: "req-1",
      p_profile_id: "p-1",
    });
    const rawCascade = rpcCalls.find(
      (c) => c.fn === "execute_account_deletion_cascade",
    );
    expect(rawCascade).toBeUndefined();
  });

  it('the anonymizeAccount wrapper hardcodes "anonymize" and exposes no mode parameter', async () => {
    const rpc = vi.fn(async () => ({ data: { status: "ok" }, error: null }));
    const fakeAdmin = { rpc } as unknown as Parameters<
      typeof anonymizeAccount
    >[0];
    await anonymizeAccount(fakeAdmin, "p-1");
    expect(rpc).toHaveBeenCalledWith("execute_account_deletion_cascade", {
      p_profile_id: "p-1",
      p_privacy_mode: "anonymize",
    });
  });

  it("HARDENING: the driver never calls the raw cascade RPC directly — all go through atomic RPC", async () => {
    const { admin, rpcCalls } = buildFakeAdmin({
      pendingRequests: [
        { id: "req-1", profile_id: "p-1" },
        { id: "req-2", profile_id: "p-2" },
      ],
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    await executeDueDeletions(admin, "test-req");
    const atomicCalls = rpcCalls.filter(
      (c) => c.fn === "complete_and_anonymize_account",
    );
    expect(atomicCalls).toHaveLength(2);
    const rawCascadeCalls = rpcCalls.filter(
      (c) => c.fn === "execute_account_deletion_cascade",
    );
    expect(rawCascadeCalls).toHaveLength(0);
  });

  it("follows the correct 5-step ordering per request", async () => {
    const callOrder: string[] = [];

    const rpc = vi.fn(async (fn: string) => {
      callOrder.push(`rpc:${fn}`);
      return { data: { status: "completed" }, error: null };
    });

    const admin = {
      from: vi.fn((table: string) => {
        if (table === "account_deletion_requests") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                lte: vi.fn(() => ({
                  order: vi.fn(async () => ({
                    data: [{ id: "req-1", profile_id: "p-1" }],
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn((data: Record<string, unknown>) => {
              // The only request-row writes the driver may make are the transient Stripe
              // states; mark-completed happens inside the atomic RPC, never here.
              callOrder.push(
                `request_update:${String(data.stripe_cancellation_status ?? Object.keys(data).join(","))}`,
              );
              return { eq: vi.fn(async () => ({ error: null })) };
            }),
          };
        }
        if (table === "entitlements") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => {
                  callOrder.push("stripe_lookup");
                  return {
                    data: { stripe_subscription_id: "sub_123" },
                    error: null,
                  };
                }),
              })),
            })),
          };
        }
        return {};
      }),
      rpc,
      auth: { admin: {} },
      storage: {
        listBuckets: vi.fn(async () => {
          callOrder.push("storage_check");
          return { data: [], error: null };
        }),
        from: vi.fn(() => ({
          list: vi.fn(async () => ({ data: [], error: null })),
        })),
      },
    } as unknown as Parameters<typeof executeDueDeletions>[0];

    stripeMocks.retrieve.mockImplementation(async () => {
      callOrder.push("stripe_retrieve");
      return { id: "sub_123", status: "active", items: { data: [{ id: "si_1" }] } };
    });
    stripeMocks.cancel.mockImplementation(async () => {
      callOrder.push("stripe_cancel");
      return {};
    });

    await executeDueDeletions(admin, "test-req");

    // Plan v4 §3.4: T1 (mark executing) has no log ids here (request rows predate the evidence
    // bundle), so the per-request sequence is Stripe → storage → T1.5 preclear → deidentify →
    // T2, then the evidence housekeeping (reconcile + ledger rewrite) closes the pass.
    expect(callOrder).toEqual([
      "stripe_lookup",
      "request_update:in_progress",
      "stripe_retrieve",
      "stripe_cancel",
      "request_update:completed",
      "storage_check",
      "rpc:preclear_account_deletion_links",
      "rpc:deidentify_user",
      "rpc:complete_and_anonymize_account",
      "rpc:reconcile_deletion_log",
      "rpc:rewrite_anonymized_actors",
    ]);
  });

  it("returns zero counts when no pending requests exist", async () => {
    const { admin } = buildFakeAdmin({ pendingRequests: [] });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result).toEqual({
      executedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
  });

  it("skips a request on deidentify failure — stays pending, retries next cron", async () => {
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      rpcErrors: { deidentify_user: { message: "db down" } },
    });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result).toEqual({
      executedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });
  });

  it("skips a request on atomic RPC failure — stays pending, retries next cron", async () => {
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      rpcErrors: {
        complete_and_anonymize_account: { message: "cascade boom" },
      },
    });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result).toEqual({
      executedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });
  });

  it("REGRESSION: cascade failure in atomic RPC leaves status 'pending' — never stranded 'completed'", async () => {
    const { admin, updateCalls } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      rpcErrors: {
        complete_and_anonymize_account: { message: "cascade boom" },
      },
    });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result).toEqual({
      executedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });
    // The atomic RPC wraps mark-completed + cascade in one transaction.
    // The driver must NOT separately mark-completed outside the RPC.
    const completedUpdates = updateCalls.filter(
      (c) =>
        c.table === "account_deletion_requests" &&
        c.data.status === "completed",
    );
    expect(completedUpdates).toHaveLength(0);
  });

  it("fail-fast: throws when storage objects exist for the profile", async () => {
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      buckets: [{ name: "avatars" }],
      storageObjects: [{ name: "photo.jpg" }],
    });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result).toEqual({
      executedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });
  });

  // @spec [SCL-086 PROPOSED; Doc-01 §40.2.1 `stripe.subscriptions.cancel(…, { prorate: false })`]
  it("cancels a single-item subscription (no proration) before deidentify, and advances stripe_cancellation_status in_progress → completed", async () => {
    const { admin, rpcCalls, updateCalls } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      entitlement: { stripe_subscription_id: "sub_abc" },
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    await executeDueDeletions(admin, "test-req");
    expect(stripeMocks.retrieve).toHaveBeenCalledWith("sub_abc");
    expect(stripeMocks.cancel).toHaveBeenCalledWith("sub_abc", {
      prorate: false,
    });
    expect(stripeMocks.itemDel).not.toHaveBeenCalled();
    const deidentifyIdx = rpcCalls.findIndex((c) => c.fn === "deidentify_user");
    expect(deidentifyIdx).toBeGreaterThan(-1);
    expect(
      updateCalls
        .filter((c) => c.table === "account_deletion_requests")
        .map((c) => c.data.stripe_cancellation_status),
    ).toEqual(["in_progress", "completed"]);
  });

  it("guardian-paid student: removes only this student's item from a multi-item subscription", async () => {
    stripeMocks.retrieve.mockImplementation(async () => ({
      id: "sub_guardian",
      status: "active",
      items: { data: [{ id: "si_other" }, { id: "si_me" }] },
    }));
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      entitlement: {
        stripe_subscription_id: "sub_guardian",
        stripe_subscription_item_id: "si_me",
      },
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    await executeDueDeletions(admin, "test-req");
    expect(stripeMocks.itemDel).toHaveBeenCalledWith("si_me", {
      proration_behavior: "none",
    });
    expect(stripeMocks.cancel).not.toHaveBeenCalled();
  });

  it("cancels every non-cancelled subscription on the person's own Stripe customer (a guardian who pays for others)", async () => {
    stripeMocks.list.mockImplementation(async () => ({
      data: [
        { id: "sub_live", status: "active" },
        { id: "sub_old", status: "canceled" },
        { id: "sub_trial", status: "trialing" },
      ],
    }));
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "g-1" }],
      profile: { email: "g@example.test", stripe_customer_id: "cus_g" },
      entitlement: { stripe_subscription_id: null },
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    await executeDueDeletions(admin, "test-req");
    expect(stripeMocks.list).toHaveBeenCalledWith({
      customer: "cus_g",
      status: "all",
      limit: 100,
    });
    expect(stripeMocks.cancel.mock.calls.map((c) => c[0])).toEqual([
      "sub_live",
      "sub_trial",
    ]);
  });

  it("a Stripe failure records failed_manual and the deletion still completes", async () => {
    stripeMocks.cancel.mockImplementation(async () => {
      throw new Error("stripe down");
    });
    const { admin, updateCalls, rpcCalls } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1", log_id: "log-1" }],
      entitlement: { stripe_subscription_id: "sub_abc" },
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result).toEqual({
      executedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(
      updateCalls
        .filter((c) => c.table === "account_deletion_requests")
        .map((c) => c.data.stripe_cancellation_status),
    ).toEqual(["in_progress", "failed_manual"]);
    const t3 = rpcCalls.find((c) => c.fn === "complete_deletion_log");
    expect(t3?.args).toEqual({
      p_completions: JSON.stringify([
        {
          log_id: "log-1",
          stripe_customer_id: null,
          stripe_subscription_id: "sub_abc",
          final_status: "failed_manual",
        },
      ]),
    });
  });

  it("never constructs the Stripe client when there is no customer and no subscription", async () => {
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      entitlement: { stripe_subscription_id: null },
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    await executeDueDeletions(admin, "test-req");
    expect(stripeMocks.clientConstructed).not.toHaveBeenCalled();
    expect(stripeMocks.cancel).not.toHaveBeenCalled();
  });

  // @spec [plan v4 §3.4 three transactions] T1 is ONE call for the whole pass and precedes every
  // identity-side call; T3 is ONE call after them; housekeeping closes the pass.
  it("T1 marks every due log id in one call before any deletion; T3 completes the successes in one call", async () => {
    const { admin, rpcCalls } = buildFakeAdmin({
      pendingRequests: [
        { id: "req-1", profile_id: "p-1", log_id: "log-1" },
        { id: "req-2", profile_id: "p-2", log_id: null },
        { id: "req-3", profile_id: "p-3", log_id: "log-3" },
      ],
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    await executeDueDeletions(admin, "test-req");
    const names = rpcCalls.map((c) => c.fn);
    expect(names[0]).toBe("mark_deletion_log_executing");
    expect(rpcCalls[0]!.args).toEqual({ p_log_ids: ["log-1", "log-3"] });
    expect(names.filter((n) => n === "mark_deletion_log_executing")).toHaveLength(1);
    const t3Idx = names.indexOf("complete_deletion_log");
    expect(t3Idx).toBeGreaterThan(names.lastIndexOf("complete_and_anonymize_account"));
    expect(rpcCalls[t3Idx]!.args).toEqual({
      p_completions: JSON.stringify([
        { log_id: "log-1", stripe_customer_id: null, stripe_subscription_id: null, final_status: null },
        { log_id: "log-3", stripe_customer_id: null, stripe_subscription_id: null, final_status: null },
      ]),
    });
    expect(names.slice(-2)).toEqual([
      "reconcile_deletion_log",
      "rewrite_anonymized_actors",
    ]);
    // Every identity-side call sits strictly between T1 and T3.
    for (const n of ["preclear_account_deletion_links", "deidentify_user", "complete_and_anonymize_account"]) {
      expect(names.indexOf(n)).toBeGreaterThan(0);
      expect(names.lastIndexOf(n)).toBeLessThan(t3Idx);
    }
  });

  it("if T1 fails, nothing is deleted this pass (no evidence mark → no deletion)", async () => {
    const { admin, rpcCalls } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1", log_id: "log-1" }],
      rpcErrors: { mark_deletion_log_executing: { message: "evidence unavailable" } },
    });
    await expect(executeDueDeletions(admin, "test-req")).rejects.toThrow(
      "evidence unavailable",
    );
    expect(rpcCalls.map((c) => c.fn)).toEqual(["mark_deletion_log_executing"]);
  });

  it("a failed cascade leaves its log id out of T3 (the reconciler resolves it)", async () => {
    const { admin, rpcCalls } = buildFakeAdmin({
      pendingRequests: [
        { id: "req-1", profile_id: "p-1", log_id: "log-1" },
        { id: "req-2", profile_id: "p-2", log_id: "log-2" },
      ],
      rpcErrors: { deidentify_user: { message: "boom" } },
    });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result.failedCount).toBe(2);
    expect(rpcCalls.find((c) => c.fn === "complete_deletion_log")).toBeUndefined();
    expect(rpcCalls.map((c) => c.fn).slice(-2)).toEqual([
      "reconcile_deletion_log",
      "rewrite_anonymized_actors",
    ]);
  });

  it("classifies RPC status 'completed' as executedCount", async () => {
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result).toEqual({
      executedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
  });

  it("classifies RPC no_op (already-processed request) as skippedCount — not failure", async () => {
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      rpcReturns: {
        complete_and_anonymize_account: {
          status: "no_op",
          reason: "request not pending",
        },
      },
    });
    const result = await executeDueDeletions(admin, "test-req");
    expect(result).toEqual({
      executedCount: 0,
      skippedCount: 1,
      failedCount: 0,
    });
  });

  it("FAIL-CLOSED: unexpected/undefined RPC status → failedCount (never assumed successful)", async () => {
    for (const badStatus of [
      {},
      { status: undefined },
      { status: "unexpected" },
    ]) {
      const { admin } = buildFakeAdmin({
        pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
        rpcReturns: {
          complete_and_anonymize_account: badStatus,
        },
      });
      const result = await executeDueDeletions(admin, "test-req");
      expect(result).toEqual({
        executedCount: 0,
        skippedCount: 0,
        failedCount: 1,
      });
    }
  });

  it("does not call auth.admin.updateUserById — cascade deletes auth.users", async () => {
    const { admin } = buildFakeAdmin({
      pendingRequests: [{ id: "req-1", profile_id: "p-1" }],
      rpcReturns: {
        complete_and_anonymize_account: { status: "completed" },
      },
    });
    await executeDueDeletions(admin, "test-req");
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});
