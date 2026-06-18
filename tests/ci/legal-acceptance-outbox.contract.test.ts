import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  captureLegalAcceptances,
  drainLegalAcceptanceOutbox,
} from "../../server/lib/legal-acceptance";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1] Decoupling consent recording from session
 * survival: a legal-acceptance write failure must NEVER throw into the auth path; the intent is
 * captured durably and drained to completion. Proven deterministically with a mocked admin client.
 */

type Result = { error: { message: string } | null };

type OutboxRow = { id: string; payload: unknown; attempts: number };

type AdminOpts = {
  legalUpsert?: () => Result;
  outboxInsert?: () => Result;
  outboxRows?: OutboxRow[];
};

function makeAdmin(opts: AdminOpts) {
  const legalUpsertSpy = vi.fn();
  const outboxInsertSpy = vi.fn();
  const outboxUpdateSpy = vi.fn();

  const from = (table: string) => {
    if (table === "legal_acceptances") {
      return {
        upsert: (rows: unknown) => {
          legalUpsertSpy(rows);
          return Promise.resolve(opts.legalUpsert?.() ?? { error: null });
        },
      };
    }
    if (table === "legal_acceptance_outbox") {
      return {
        insert: (row: unknown) => {
          outboxInsertSpy(row);
          return Promise.resolve(opts.outboxInsert?.() ?? { error: null });
        },
        select: () => ({
          eq: () => ({
            is: () => ({
              limit: () =>
                Promise.resolve({
                  data: opts.outboxRows ?? [],
                  error: null,
                }),
            }),
          }),
        }),
        update: (patch: unknown) => ({
          eq: (_col: string, id: string) => {
            outboxUpdateSpy(patch, id);
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  };

  return {
    admin: { from } as unknown as SupabaseClient,
    legalUpsertSpy,
    outboxInsertSpy,
    outboxUpdateSpy,
  };
}

const ARGS = {
  userId: "user-1",
  consentSource: "email_signup_form" as const,
  acceptances: [
    {
      docKey: "student_terms",
      docVersion: "2024-12-20",
      actorType: "student" as const,
      minor: false,
    },
  ],
  userAgent: null,
  ipAddress: null,
};

describe("Legal-acceptance decoupling (AS-1)", () => {
  it("records directly and does NOT enqueue when the write succeeds", async () => {
    const { admin, legalUpsertSpy, outboxInsertSpy } = makeAdmin({
      legalUpsert: () => ({ error: null }),
    });

    await expect(captureLegalAcceptances(admin, ARGS)).resolves.toBeUndefined();

    expect(legalUpsertSpy).toHaveBeenCalledTimes(1);
    expect(outboxInsertSpy).not.toHaveBeenCalled();
  });

  it("enqueues to the outbox WITHOUT throwing when the direct write fails", async () => {
    const { admin, outboxInsertSpy } = makeAdmin({
      legalUpsert: () => ({ error: { message: "relation does not exist" } }),
    });

    // The core invariant: this must resolve, never reject — auth must not depend on it.
    await expect(captureLegalAcceptances(admin, ARGS)).resolves.toBeUndefined();

    expect(outboxInsertSpy).toHaveBeenCalledTimes(1);
    const enqueued = outboxInsertSpy.mock.calls[0]?.[0] as {
      user_id: string;
      payload: { consentSource: string };
    };
    expect(enqueued.user_id).toBe("user-1");
    expect(enqueued.payload.consentSource).toBe("email_signup_form");
  });

  it("never throws even when BOTH the direct write and the enqueue fail", async () => {
    const { admin } = makeAdmin({
      legalUpsert: () => ({ error: { message: "down" } }),
      outboxInsert: () => ({ error: { message: "outbox down too" } }),
    });

    await expect(captureLegalAcceptances(admin, ARGS)).resolves.toBeUndefined();
  });

  it("drains a pending intent to legal_acceptances and marks it processed (idempotent)", async () => {
    const { admin, legalUpsertSpy, outboxUpdateSpy } = makeAdmin({
      legalUpsert: () => ({ error: null }),
      outboxRows: [
        {
          id: "outbox-1",
          attempts: 0,
          payload: {
            acceptances: ARGS.acceptances,
            consentSource: ARGS.consentSource,
            userAgent: null,
            ipAddress: null,
          },
        },
      ],
    });

    await drainLegalAcceptanceOutbox(admin, "user-1");

    expect(legalUpsertSpy).toHaveBeenCalledTimes(1);
    expect(outboxUpdateSpy).toHaveBeenCalledTimes(1);
    const [patch, id] = outboxUpdateSpy.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(id).toBe("outbox-1");
    expect(patch.processed_at).toBeTruthy();
  });

  it("is a no-op when nothing is pending", async () => {
    const { admin, legalUpsertSpy, outboxUpdateSpy } = makeAdmin({
      outboxRows: [],
    });

    await drainLegalAcceptanceOutbox(admin, "user-1");

    expect(legalUpsertSpy).not.toHaveBeenCalled();
    expect(outboxUpdateSpy).not.toHaveBeenCalled();
  });
});
