/**
 * @spec [Doc-03_V3 §21.1, SCL-023, INV-03-16, CC Brief "Crisis Path: Layer 1 Miss"]
 * @implemented 2026-09-23
 *
 * plain English: proves Layer 1 matches the exact production message
 * "I feel like I want to kill myself" against the seeded signature set,
 * and proves the notification policy is evaluated and dispatched for a
 * model-only detection (no signature match). These two bugs were observed
 * on 2026-09-22 in production trace conversation f4af950f.
 *
 * §1 — The category filter in PR A queried category IN ('crisis','safeguarding')
 * but the seeded signatures have category values 'suicide','self_harm','abuse'.
 * Zero rows matched. Fix: restore filter to signature_type = 'crisis', map
 * DB sub-categories to the two CrisisCategory lanes.
 *
 * §2 — The notification path is the same branch for both signature and model
 * detections. evaluateNotificationPolicy returns shouldNotify:true for a new
 * case. notifyCrisisEvent was called but returned early because GCP_PROJECT_ID
 * or LYCEON_CRISIS_ALERTS was not set, with no visible log. Fix: log every
 * decision and every early return at warn level.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let mockSignatureRows: Array<{
  id: string;
  signature_pattern: string;
  signature_type: string;
  category: string;
}> = [];
let mockSignatureError: unknown = null;

function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.or = () => chain;
  chain.then = (
    resolve: (v: { data: unknown; error: unknown }) => void,
  ): Promise<unknown> =>
    Promise.resolve(
      resolve({ data: mockSignatureRows, error: mockSignatureError }),
    );
  // Make the chain thenable so await resolves to { data, error }
  Object.defineProperty(chain, Symbol.toStringTag, { value: "Promise" });
  return chain;
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => makeChain(),
  },
}));

vi.mock("../../server/lib/gcp-credentials", () => ({
  getGcpCredentials: () => ({ project_id: "test-project" }),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import {
  checkCrisisSignatures,
  normalizeCrisisText,
  evaluateNotificationPolicy,
  type NotificationPolicyInput,
} from "../../server/services/tutor-crisis";

// ── Production signature set (subset matching the brief's counts) ──────

const PRODUCTION_SIGNATURES = [
  {
    id: "e6c69064-0ae6-49a4-bcd9-fc9524500a98",
    signature_pattern: "i want to kill myself",
    signature_type: "crisis",
    category: "suicide",
  },
  {
    id: "a1111111-1111-4111-8111-111111111111",
    signature_pattern: "i want to end it all",
    signature_type: "crisis",
    category: "suicide",
  },
  {
    id: "a2222222-2222-4222-8222-222222222222",
    signature_pattern: "i want to hurt myself",
    signature_type: "crisis",
    category: "self_harm",
  },
  {
    id: "a3333333-3333-4333-8333-333333333333",
    signature_pattern: "my uncle touches me",
    signature_type: "crisis",
    category: "abuse",
  },
];

// ── §1: Layer 1 match against seeded patterns ──────────────────────────

describe("Crisis Layer 1 Miss — §1: signature matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignatureError = null;
    mockSignatureRows = [...PRODUCTION_SIGNATURES];
  });

  it("matches 'I feel like I want to kill myself' against the seeded 'i want to kill myself' pattern", async () => {
    const result = await checkCrisisSignatures(
      "I feel like I want to kill myself",
    );

    expect(result.triggered).toBe(true);
    expect(result.signatureId).toBe("e6c69064-0ae6-49a4-bcd9-fc9524500a98");
    expect(result.category).toBe("crisis");
    expect(result.layer1Empty).toBe(false);
  });

  it("maps suicide category to crisis lane", async () => {
    const result = await checkCrisisSignatures("i want to end it all");

    expect(result.triggered).toBe(true);
    expect(result.category).toBe("crisis");
  });

  it("maps self_harm category to crisis lane", async () => {
    const result = await checkCrisisSignatures("i want to hurt myself");

    expect(result.triggered).toBe(true);
    expect(result.category).toBe("crisis");
  });

  it("maps abuse category to safeguarding lane", async () => {
    const result = await checkCrisisSignatures("my uncle touches me");

    expect(result.triggered).toBe(true);
    expect(result.category).toBe("safeguarding");
  });

  it("normalization produces substring containment for the production message", () => {
    const normalized = normalizeCrisisText("I feel like I want to kill myself");
    expect(normalized).toContain("i want to kill myself");
  });

  it("returns layer1Empty when no signatures are seeded", async () => {
    mockSignatureRows = [];
    const result = await checkCrisisSignatures("i want to kill myself");

    expect(result.triggered).toBe(false);
    expect(result.layer1Empty).toBe(true);
  });
});

// ── §2: notification evaluated and dispatched for model-only detection ──

describe("Crisis Layer 1 Miss — §2: notification policy for model-only detection", () => {
  const NOW = Date.now();
  const THROTTLE_MS = 2 * 60 * 1000;

  function policyInput(
    overrides: Partial<NotificationPolicyInput>,
  ): NotificationPolicyInput {
    return {
      isNewCase: true,
      caseStatus: "open",
      currentCategory: "crisis",
      priorEvents: [],
      nowMs: NOW,
      throttleWindowMs: THROTTLE_MS,
      ...overrides,
    };
  }

  it("new case with model-only source → shouldNotify true", () => {
    const result = evaluateNotificationPolicy(policyInput({ isNewCase: true }));
    expect(result.shouldNotify).toBe(true);
    expect(result.suppressionReason).toBeNull();
  });

  it("second signal on unclaimed case inside throttle → suppressed", () => {
    const result = evaluateNotificationPolicy(
      policyInput({
        isNewCase: false,
        currentCategory: "crisis",
        priorEvents: [
          {
            category: "crisis",
            created_at: new Date(NOW - 30_000).toISOString(),
          },
        ],
      }),
    );
    expect(result.shouldNotify).toBe(false);
    expect(result.suppressionReason).toBe("throttled_same_severity");
  });

  it("higher severity on claimed case → shouldNotify true (escalation)", () => {
    const result = evaluateNotificationPolicy(
      policyInput({
        isNewCase: false,
        caseStatus: "in_review",
        currentCategory: "crisis",
        priorEvents: [
          {
            category: "safeguarding",
            created_at: new Date(NOW - 10_000).toISOString(),
          },
        ],
      }),
    );
    expect(result.shouldNotify).toBe(true);
    expect(result.suppressionReason).toBeNull();
  });
});

// ── Structural: signature query filter uses signature_type, not category ──

import fs from "node:fs";
import path from "node:path";

describe("Crisis Layer 1 Miss — structural regression guards", () => {
  it("checkCrisisSignatures filters on signature_type = 'crisis', not category", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/tutor-crisis.ts"),
      "utf-8",
    );
    expect(source).toContain('.eq("signature_type", "crisis")');
    expect(source).not.toContain("category.eq.crisis,category.eq.safeguarding");
  });

  it("route handler logs both notification dispatch and suppression decisions", () => {
    const routeSource = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    expect(routeSource).toContain("crisis_notification_dispatching");
    expect(routeSource).toContain("crisis_notification_suppressed");
  });

  it("notifyCrisisEvent logs on entry before any early return", () => {
    const notifySource = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/crisis-notification.ts"),
      "utf-8",
    );
    expect(notifySource).toContain("dispatch_entered");
  });

  it("notifyCrisisEvent logs missing credentials at warn level, not debug", () => {
    const notifySource = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/crisis-notification.ts"),
      "utf-8",
    );
    const noGcpMatch = notifySource.match(
      /logger\.(\w+)\(\s*"CRISIS_NOTIFICATION",\s*"no_gcp_credentials"/,
    );
    expect(noGcpMatch).not.toBeNull();
    expect(noGcpMatch![1]).toBe("warn");
  });
});
