// @spec [GAP-ID-11 | docs/Spec/lyceon-coding-standards.md §6 (server-authoritative), §7.1 (Zod), §8.3] | @implemented [2026-06-07]
// plain English: executable proof of the guardian-consent-verify hardening.
// Proves: a forged/absent metadata binding cannot approve consent (400, no DB
// mutation); a revoked/expired request is not approved; approval is idempotent;
// the metadata-bound happy path approves; and create-checkout sets customer_email
// server-side. The router is re-imported per test (vi.resetModules) so each test
// gets a fresh in-memory rate-limit store.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

// ---- Hoisted mock fns (shared across the dynamic re-imports) ----------------
const h = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  getStripe: vi.fn(),
  createGuardianLink: vi.fn(),
  ensureAccountForUser: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../../server/middleware/supabase-auth", () => ({
  getSupabaseAdmin: h.getSupabaseAdmin,
}));
vi.mock("../../server/lib/stripe/client", () => ({
  getStripeClient: h.getStripe,
}));
vi.mock("../../server/lib/account", () => ({
  createGuardianLink: h.createGuardianLink,
  ensureAccountForUser: h.ensureAccountForUser,
}));
vi.mock("../../server/lib/email", () => ({
  sendEmail: h.sendEmail,
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---- Fake supabase admin: records update/insert calls, serves selects -------
type ConsentRow = {
  id: string;
  child_id: string;
  guardian_email: string;
  status: string;
  expires_at: string;
};

type AdminState = {
  request: ConsentRow | null;
  existingGuardian: { id: string } | null;
};

type Mutation = {
  table: string;
  op: "update" | "insert";
  payload: unknown;
  filters: Record<string, unknown>;
};

function makeAdmin(state: AdminState): {
  admin: unknown;
  mutations: Mutation[];
} {
  const mutations: Mutation[] = [];

  const from = (table: string) => {
    const ctx: {
      op: "select" | "update" | "insert";
      payload: unknown;
      filters: Record<string, unknown>;
    } = {
      op: "select",
      payload: undefined,
      filters: {},
    };

    const resolveSelect = (): { data: unknown; error: unknown } => {
      if (table === "guardian_consent_requests") {
        const row = state.request;
        if (row && ctx.filters.id === row.id) return { data: row, error: null };
        return { data: null, error: { message: "not found" } };
      }
      if (table === "profiles") {
        // select('id').eq('email', ...) → existing guardian lookup
        if ("email" in ctx.filters) {
          return state.existingGuardian
            ? { data: state.existingGuardian, error: null }
            : { data: null, error: { message: "not found" } };
        }
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (payload: unknown) => {
        ctx.op = "update";
        ctx.payload = payload;
        return builder;
      },
      insert: (payload: unknown) => {
        ctx.op = "insert";
        ctx.payload = payload;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        ctx.filters[col] = val;
        return builder;
      },
      single: () => Promise.resolve(resolveSelect()),
      maybeSingle: () => Promise.resolve(resolveSelect()),
      // Awaiting the builder directly resolves a write (update/insert path).
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
        if (ctx.op === "update" || ctx.op === "insert") {
          mutations.push({
            table,
            op: ctx.op,
            payload: ctx.payload,
            filters: { ...ctx.filters },
          });
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return builder;
  };

  const admin = {
    from,
    auth: { admin: { generateLink: vi.fn() } },
  };
  return { admin, mutations };
}

// ---- Fake Stripe ------------------------------------------------------------
type StripeSession = {
  payment_status: string;
  metadata: Record<string, string>;
  payment_intent: { id: string; status: string } | null;
};

function makeStripe(session: StripeSession): {
  stripe: unknown;
  createArgs: unknown[];
} {
  const createArgs: unknown[] = [];
  const stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => session),
        create: vi.fn(async (args: unknown) => {
          createArgs.push(args);
          return {
            url: "https://stripe.test/checkout",
            payment_intent: "pi_1",
          };
        }),
      },
    },
    paymentIntents: { cancel: vi.fn(async () => ({})) },
  };
  return { stripe, createArgs };
}

const REQUEST_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const CHILD_ID = "33333333-3333-3333-3333-333333333333";
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function pendingRow(overrides: Partial<ConsentRow> = {}): ConsentRow {
  return {
    id: REQUEST_ID,
    child_id: CHILD_ID,
    guardian_email: "guardian@example.com",
    status: "pending",
    expires_at: FUTURE,
    ...overrides,
  };
}

async function buildApp(): Promise<Express> {
  vi.resetModules();
  const mod = await import("../../server/routes/guardian-consent-routes");
  const app = express();
  app.use(express.json());
  app.use("/api/consent", mod.default);
  return app;
}

describe("GAP-ID-11 — guardian consent verify is bound to Stripe session metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ID-11.1 forged body requestId that mismatches metadata → 400, no DB mutation", async () => {
    const { admin, mutations } = makeAdmin({
      request: pendingRow(),
      existingGuardian: { id: "g1" },
    });
    const { stripe } = makeStripe({
      payment_status: "paid",
      metadata: { requestId: REQUEST_ID },
      payment_intent: { id: "pi_1", status: "requires_capture" },
    });
    h.getSupabaseAdmin.mockReturnValue(admin);
    h.getStripe.mockReturnValue(stripe);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/consent/verify-session")
      .send({ sessionId: "cs_test_1", requestId: OTHER_ID });

    expect(res.status).toBe(400);
    expect(mutations).toHaveLength(0);
  });

  it("ID-11.1 absent metadata.requestId → 400, no DB mutation", async () => {
    const { admin, mutations } = makeAdmin({
      request: pendingRow(),
      existingGuardian: { id: "g1" },
    });
    const { stripe } = makeStripe({
      payment_status: "paid",
      metadata: {},
      payment_intent: { id: "pi_1", status: "requires_capture" },
    });
    h.getSupabaseAdmin.mockReturnValue(admin);
    h.getStripe.mockReturnValue(stripe);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/consent/verify-session")
      .send({ sessionId: "cs_test_1" });

    expect(res.status).toBe(400);
    expect(mutations).toHaveLength(0);
  });

  it("ID-11.4 expired request → 400, no DB mutation", async () => {
    const { admin, mutations } = makeAdmin({
      request: pendingRow({ expires_at: PAST }),
      existingGuardian: { id: "g1" },
    });
    const { stripe } = makeStripe({
      payment_status: "paid",
      metadata: { requestId: REQUEST_ID },
      payment_intent: { id: "pi_1", status: "requires_capture" },
    });
    h.getSupabaseAdmin.mockReturnValue(admin);
    h.getStripe.mockReturnValue(stripe);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/consent/verify-session")
      .send({ sessionId: "cs_test_1", requestId: REQUEST_ID });

    expect(res.status).toBe(400);
    expect(mutations).toHaveLength(0);
  });

  it("ID-11.3 revoked (non-pending) request → 409, not approved", async () => {
    const { admin, mutations } = makeAdmin({
      request: pendingRow({ status: "revoked" }),
      existingGuardian: { id: "g1" },
    });
    const { stripe } = makeStripe({
      payment_status: "paid",
      metadata: { requestId: REQUEST_ID },
      payment_intent: { id: "pi_1", status: "requires_capture" },
    });
    h.getSupabaseAdmin.mockReturnValue(admin);
    h.getStripe.mockReturnValue(stripe);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/consent/verify-session")
      .send({ sessionId: "cs_test_1", requestId: REQUEST_ID });

    expect(res.status).toBe(409);
    expect(mutations).toHaveLength(0);
  });

  it("ID-11.5 replay on already-approved request → success, no second update", async () => {
    const { admin, mutations } = makeAdmin({
      request: pendingRow({ status: "approved" }),
      existingGuardian: { id: "g1" },
    });
    const { stripe } = makeStripe({
      payment_status: "paid",
      metadata: { requestId: REQUEST_ID },
      payment_intent: { id: "pi_1", status: "requires_capture" },
    });
    h.getSupabaseAdmin.mockReturnValue(admin);
    h.getStripe.mockReturnValue(stripe);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/consent/verify-session")
      .send({ sessionId: "cs_test_1", requestId: REQUEST_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mutations).toHaveLength(0);
  });

  it("ID-11.6 valid metadata-bound flow → approved (status + profile mutated)", async () => {
    const { admin, mutations } = makeAdmin({
      request: pendingRow(),
      existingGuardian: { id: "g1" },
    });
    const { stripe } = makeStripe({
      payment_status: "paid",
      metadata: { requestId: REQUEST_ID },
      payment_intent: { id: "pi_1", status: "requires_capture" },
    });
    h.getSupabaseAdmin.mockReturnValue(admin);
    h.getStripe.mockReturnValue(stripe);
    h.ensureAccountForUser.mockResolvedValue("acct_1");

    const app = await buildApp();
    const res = await request(app)
      .post("/api/consent/verify-session")
      .send({ sessionId: "cs_test_1", requestId: REQUEST_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const consentUpdate = mutations.find(
      (m) => m.table === "guardian_consent_requests" && m.op === "update",
    );
    const profileUpdate = mutations.find(
      (m) => m.table === "profiles" && m.op === "update",
    );
    expect(consentUpdate).toBeTruthy();
    expect(consentUpdate?.filters.id).toBe(REQUEST_ID);
    expect((consentUpdate?.payload as { status?: string }).status).toBe(
      "approved",
    );
    expect(profileUpdate).toBeTruthy();
    expect(profileUpdate?.filters.id).toBe(CHILD_ID);
    expect(
      (profileUpdate?.payload as { guardian_consent?: boolean })
        .guardian_consent,
    ).toBe(true);
  });

  it("ID-11.7 missing sessionId → 400 (Zod), no Stripe retrieve, no mutation", async () => {
    const { admin, mutations } = makeAdmin({
      request: pendingRow(),
      existingGuardian: { id: "g1" },
    });
    const { stripe } = makeStripe({
      payment_status: "paid",
      metadata: { requestId: REQUEST_ID },
      payment_intent: { id: "pi_1", status: "requires_capture" },
    });
    h.getSupabaseAdmin.mockReturnValue(admin);
    h.getStripe.mockReturnValue(stripe);

    const app = await buildApp();
    const res = await request(app).post("/api/consent/verify-session").send({});

    expect(res.status).toBe(400);
    expect(mutations).toHaveLength(0);
  });

  it("ID-11.9 create-checkout-session sets customer_email server-side from stored guardian_email", async () => {
    const { admin } = makeAdmin({
      request: pendingRow(),
      existingGuardian: null,
    });
    const { stripe, createArgs } = makeStripe({
      payment_status: "unpaid",
      metadata: { requestId: REQUEST_ID },
      payment_intent: null,
    });
    h.getSupabaseAdmin.mockReturnValue(admin);
    h.getStripe.mockReturnValue(stripe);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/consent/create-checkout-session")
      .send({ requestId: REQUEST_ID });

    expect(res.status).toBe(200);
    expect(createArgs).toHaveLength(1);
    expect((createArgs[0] as { customer_email?: string }).customer_email).toBe(
      "guardian@example.com",
    );
    expect(
      (createArgs[0] as { metadata?: { requestId?: string } }).metadata
        ?.requestId,
    ).toBe(REQUEST_ID);
  });
});
