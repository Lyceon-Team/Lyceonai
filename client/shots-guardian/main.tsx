/**
 * Screenshot harness for parent seats, the teen invite and book-a-call — NOT shipped.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §3 ("DESIGN.md §5 checklist with screenshots in the PR"); DESIGN.md §5] |
 *       @implemented [2026-11-19]
 *
 * plain English: mounts the REAL components (GuardianShell + GuardianNoStudents, the seat card,
 * the seat checkout dialog, the /join page) with `fetch` answered from a per-scene table, so the
 * pictures are of the shipped components and tokens. `?scene=` picks the table. The responses
 * are parsed by the components' own shared schemas, so a table that drifted from the wire
 * shape would fail to render rather than photograph something the server never sends.
 *
 * Wrapper chrome is inline style: tailwind scans `client/src` only (see client/shots-billing).
 */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { GuardianShell } from "@/components/layout/GuardianShell";
import { GuardianNoStudents } from "@/features/guardian/GuardianHome";
import { GuardianSeatCards } from "@/features/guardian/GuardianSeatCard";
import JoinPage from "@/pages/join";
import type { ShotUser } from "./auth-stub";
import "@/index.css";
import "@/styles/tokens.css";
import "@/styles/student-tokens.css";
import "@/styles/accessibility.css";

const GUARDIAN: ShotUser = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "guardian",
  display_name: "Sam",
  email: "parent@example.com",
  requiredProfileComplete: true,
  profile_completed_at: "2026-11-01T00:00:00.000Z",
};
const STUDENT: ShotUser = {
  ...GUARDIAN,
  id: "22222222-2222-4222-8222-222222222222",
  role: "student",
  display_name: "Bo",
};
const SEAT_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES = new Date(Date.now() + 6 * 86_400_000).toISOString();
const TOKEN = "A".repeat(43);

type Reply = { status: number; body: unknown } | "pending";
type Table = Record<string, Reply>;

const PLANS = {
  plans: [
    {
      plan: "monthly",
      label: "Monthly",
      amountCents: 2999,
      currency: "usd",
      intervalLabel: "month",
      interval: "month",
      intervalCount: 1,
      stripePriceIdConfigured: true,
    },
    {
      plan: "quarterly",
      label: "3 months",
      amountCents: 7499,
      currency: "usd",
      intervalLabel: "3 months",
      interval: "month",
      intervalCount: 3,
      stripePriceIdConfigured: true,
    },
  ],
};
const seats = (seat: unknown[]): Reply => ({
  status: 200,
  body: { seats: seat },
});
const SEAT_NO_INVITE = { id: SEAT_ID, invite: null, claimRefused: false };
const SEAT_INVITED = {
  id: SEAT_ID,
  invite: { email: "bo@example.com", expiresAt: EXPIRES },
  claimRefused: false,
};
const SEAT_REFUSED = { id: SEAT_ID, invite: null, claimRefused: true };

type Scene = {
  view: "home" | "seat" | "join";
  user: ShotUser | null;
  table: Table;
};
const SCENES: Record<string, Scene> = {
  "home-buy": {
    view: "home",
    user: GUARDIAN,
    table: {
      "/api/guardian/seats": seats([]),
      "/api/billing/plans": { status: 200, body: PLANS },
    },
  },
  "home-seat-waiting": {
    view: "home",
    user: GUARDIAN,
    table: { "/api/guardian/seats": seats([SEAT_NO_INVITE]) },
  },
  "seat-no-invite": {
    view: "seat",
    user: GUARDIAN,
    table: { "/api/guardian/seats": seats([SEAT_NO_INVITE]) },
  },
  "seat-invited": {
    view: "seat",
    user: GUARDIAN,
    table: { "/api/guardian/seats": seats([SEAT_INVITED]) },
  },
  "seat-already-pro": {
    view: "seat",
    user: GUARDIAN,
    table: { "/api/guardian/seats": seats([SEAT_REFUSED]) },
  },
  "seat-loading": {
    view: "seat",
    user: GUARDIAN,
    table: { "/api/guardian/seats": "pending" },
  },
  "seat-error": {
    view: "seat",
    user: GUARDIAN,
    table: {
      "/api/guardian/seats": {
        status: 500,
        body: { error: { message: "boom" } },
      },
    },
  },
  "join-loading": {
    view: "join",
    user: null,
    table: { [`/api/join/${TOKEN}`]: "pending" },
  },
  "join-error": {
    view: "join",
    user: null,
    table: {
      [`/api/join/${TOKEN}`]: {
        status: 500,
        body: { error: { message: "boom" } },
      },
    },
  },
  "join-invalid": {
    view: "join",
    user: STUDENT,
    table: { [`/api/join/${TOKEN}`]: { status: 200, body: { valid: false } } },
  },
  "join-signed-out": {
    view: "join",
    user: null,
    table: { [`/api/join/${TOKEN}`]: { status: 200, body: { valid: true } } },
  },
  "join-ready": {
    view: "join",
    user: STUDENT,
    table: { [`/api/join/${TOKEN}`]: { status: 200, body: { valid: true } } },
  },
  "join-already-pro": {
    view: "join",
    user: STUDENT,
    table: {
      [`/api/join/${TOKEN}`]: { status: 200, body: { valid: true } },
      [`/api/join/${TOKEN}/claim`]: {
        status: 200,
        body: { outcome: "already_paid" },
      },
    },
  },
  "join-not-student": {
    view: "join",
    user: GUARDIAN,
    table: { [`/api/join/${TOKEN}`]: { status: 200, body: { valid: true } } },
  },
};

const name = new URLSearchParams(window.location.search).get("scene") ?? "";
const scene = SCENES[name];
if (scene === undefined) throw new Error(`unknown ?scene=${name}`);
window.__shotUser = scene.user;

// Anything a scene does not name (the bell, the payment banner, the csrf token) gets an empty
// 200, so the shell's own queries settle quietly instead of photographing their error states.
window.fetch = async (input: RequestInfo | URL): Promise<Response> => {
  const raw = input instanceof Request ? input.url : String(input);
  const key = new URL(raw, window.location.origin).pathname;
  const reply = scene.table[key];
  if (reply === "pending") return new Promise<Response>(() => undefined);
  if (key === "/api/csrf-token")
    return Response.json({ csrfToken: "shot" }, { status: 200 });
  if (reply === undefined) return Response.json({}, { status: 200 });
  return Response.json(reply.body, { status: reply.status });
};

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function View(): JSX.Element {
  if (scene.view === "home") {
    return (
      <GuardianShell>
        <GuardianNoStudents onAdd={() => undefined} />
      </GuardianShell>
    );
  }
  if (scene.view === "seat") {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 32,
          background: "var(--background)",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <GuardianSeatCards />
        </div>
      </div>
    );
  }
  // /join renders in the bare card shell in the app; reproduce its frame.
  return (
    <div className="lyc" style={{ minHeight: "100vh", padding: 40 }}>
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: 32,
          borderRadius: 16,
          background: "var(--sheet)",
          border: "1px solid var(--rule)",
        }}
      >
        <JoinPage params={{ token: TOKEN }} />
      </div>
    </div>
  );
}

const mount = document.getElementById("root");
if (mount === null) throw new Error("no #root");
createRoot(mount).render(
  <QueryClientProvider client={client}>
    <Router>
      <View />
    </Router>
  </QueryClientProvider>,
);
