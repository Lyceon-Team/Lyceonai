/**
 * Onboarding events to Resend Automations — the rules, without a network or a database.
 *
 * @spec [owner brief "Email lane — send onboarding events to Resend" + ruling (Karl, 2026-10-12)]
 *       | @implemented [2026-10-12]
 *
 * plain English: server/lib/lifecycle-email.ts decides who gets a contact and an event, and what
 * it carries. The route-level proof over real Postgres is lifecycle-email.pg.ci.test.ts; this
 * file pins each rule with a recording Resend:
 *   - the first-name rule (first word, 2+ letters, no digits, not the address's local part);
 *   - the denylist (env domains + addresses, and "test" in the local part);
 *   - skips: under 13 (date of birth; unknown is not 13+), deleted, deletion pending, deletion
 *     state unreadable, denylisted — none reaches Resend;
 *   - `lyceon.entitled` + `entitled = "true"` for the student and, when someone else paid, the
 *     payer; an under-13 student is skipped while the guardian payer still gets it;
 *   - a Resend failure stops that recipient, is logged with the profile id and status only;
 *   - every after-response send is handed to Vercel's `waitUntil` (Karl, 2026-10-13), as a promise
 *     that settles only once the send has finished, and never rejects (a throw is logged).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as unknown[][]);
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]): void => {
    logged.push(args);
  };
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});

const vercel = vi.hoisted(() => ({
  waitUntil: vi.fn((_promise: Promise<unknown>): void => undefined),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vercel.waitUntil }));

import {
  ENTITLED_EVENT,
  ONBOARDED_EVENT,
  fireLifecycle,
  isDenylisted,
  lifecycleFirstName,
  parseDenylist,
  sendEntitledEvents,
  sendOnboardedEvent,
  type LifecycleDeps,
  type LifecycleProfile,
} from "../../server/lib/lifecycle-email";
import { createResendContactsTransport } from "../../server/lib/notifications/transport";

const STUDENT = "aaaaaaaa-0000-4000-8000-000000000001";
const GUARDIAN = "aaaaaaaa-0000-4000-8000-000000000002";
const TODAY = new Date("2026-10-12T12:00:00Z");

function profile(
  over: Partial<LifecycleProfile> & { id: string },
): LifecycleProfile {
  return {
    email: `${over.id.slice(-4)}@home.example`,
    role: "student",
    display_name: "Ana Lopez",
    date_of_birth: "2010-01-01",
    deleted_at: null,
    ...over,
  };
}

type Call = {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
};

function harness(
  profiles: LifecycleProfile[],
  opts: {
    pending?: Record<string, boolean | null>;
    denylist?: string;
    failStatus?: { path: RegExp; status: number };
  } = {},
): { deps: LifecycleDeps; calls: Call[] } {
  const calls: Call[] = [];
  const known = new Set<string>();
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : null;
    const path = decodeURIComponent(url.pathname);
    calls.push({ method, path, body });
    const reply = (status: number, b: unknown) =>
      new Response(JSON.stringify(b), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (opts.failStatus && opts.failStatus.path.test(path)) {
      return reply(opts.failStatus.status, { message: "nope" });
    }
    const one = /^\/contacts\/([^/]+)$/.exec(path);
    if (method === "PATCH" && one) {
      return known.has(one[1]!)
        ? reply(200, { id: "c" })
        : reply(404, { message: "not found" });
    }
    if (method === "POST" && path === "/contacts") {
      known.add(String(body?.email));
      return reply(200, { object: "contact", id: "c" });
    }
    if (method === "POST" && path === "/events/send")
      return reply(202, { object: "event" });
    return reply(500, {});
  }) as typeof fetch;
  const deps: LifecycleDeps = {
    contacts: createResendContactsTransport({
      fetchImpl,
      env: { RESEND_API_KEY: "re_test" } as NodeJS.ProcessEnv,
    }),
    loadProfile: async (id) => profiles.find((p) => p.id === id) ?? null,
    hasPendingDeletion: async (id) =>
      opts.pending && id in opts.pending ? (opts.pending[id] ?? null) : false,
    env: { LIFECYCLE_EMAIL_DENYLIST: opts.denylist ?? "" } as NodeJS.ProcessEnv,
    now: () => TODAY,
  };
  return { deps, calls };
}

const eventsOf = (calls: Call[]) =>
  calls.filter((c) => c.path === "/events/send");

beforeEach(() => {
  logged.length = 0;
  vercel.waitUntil.mockClear();
});

describe("first name", () => {
  it.each([
    ["Ana Lopez", "ana.lopez@x.example", "Ana"],
    ["  Mary-Jane Watson ", "mj@x.example", "Mary-Jane"],
    ["O'Neil", "x@x.example", "O'Neil"],
    ["Zoë", "z@x.example", "Zoë"],
  ])("%s → %s", (name, email, want) => {
    expect(lifecycleFirstName(name, email)).toBe(want);
  });

  it.each([
    ["J Doe", "j@x.example"], // a single letter
    ["ana99", "ana99@x.example"], // digits
    ["j.doe", "j.doe@x.example"], // punctuation of a username
    ["ana", "ana@x.example"], // the address's own local part
    ["", "x@x.example"],
    [null, "x@x.example"],
  ])("%s is not a usable first name", (name, email) => {
    expect(lifecycleFirstName(name, email)).toBeUndefined();
  });
});

describe("denylist", () => {
  const list = parseDenylist(
    " lyceon.ai , @partner.example, karl@founder.example ,",
  );
  it("a listed domain (and its subdomains), a listed address, and 'test' in the local part", () => {
    expect(isDenylisted("karl@lyceon.ai", list)).toBe(true);
    expect(isDenylisted("ops@mail.lyceon.ai", list)).toBe(true);
    expect(isDenylisted("someone@partner.example", list)).toBe(true);
    expect(isDenylisted("KARL@founder.example", list)).toBe(true);
    expect(isDenylisted("qa-test7@gmail.example", list)).toBe(true);
    expect(isDenylisted("Testing.Account@gmail.example", list)).toBe(true);
  });
  it("everyone else is not (presence before absence above)", () => {
    expect(isDenylisted("ana.lopez@school.example", list)).toBe(false);
    expect(isDenylisted("karl@founder.example.org", list)).toBe(false);
    expect(isDenylisted("x@notlyceon.ai", list)).toBe(false);
  });
  it("unset: only the 'test' rule applies", () => {
    expect(isDenylisted("karl@lyceon.ai", parseDenylist(undefined))).toBe(
      false,
    );
    expect(isDenylisted("test@lyceon.ai", parseDenylist(undefined))).toBe(true);
  });
});

describe("lyceon.onboarded", () => {
  it("sends one event with the role after the contact upsert", async () => {
    const { deps, calls } = harness([profile({ id: STUDENT })]);
    expect(await sendOnboardedEvent(STUDENT, deps)).toBe("sent");
    expect(eventsOf(calls)).toEqual([
      {
        method: "POST",
        path: "/events/send",
        body: {
          event: ONBOARDED_EVENT,
          email: "0001@home.example",
          payload: { role: "student" },
        },
      },
    ]);
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      path: "/contacts/0001@home.example",
    });
  });

  it.each([
    ["under 13", profile({ id: STUDENT, date_of_birth: "2015-06-01" }), {}],
    [
      "no date of birth (unknown is not 13+)",
      profile({ id: STUDENT, date_of_birth: null }),
      {},
    ],
    [
      "deleted",
      profile({ id: STUDENT, deleted_at: "2026-10-01T00:00:00Z" }),
      {},
    ],
    [
      "deletion pending",
      profile({ id: STUDENT }),
      { pending: { [STUDENT]: true } },
    ],
    [
      "deletion state unreadable",
      profile({ id: STUDENT }),
      { pending: { [STUDENT]: null } },
    ],
    ["denylisted", profile({ id: STUDENT }), { denylist: "home.example" }],
    ["not a student or guardian", profile({ id: STUDENT, role: "admin" }), {}],
  ] as const)("%s: nothing reaches Resend", async (_label, p, opts) => {
    const { deps, calls } = harness([p], opts);
    expect(await sendOnboardedEvent(STUDENT, deps)).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("a Resend rejection stops before the event and is logged with the profile id and status, never the address", async () => {
    const { deps, calls } = harness([profile({ id: STUDENT })], {
      failStatus: { path: /^\/contacts/, status: 422 },
    });
    expect(await sendOnboardedEvent(STUDENT, deps)).toBe("failed");
    expect(eventsOf(calls)).toEqual([]);
    const text = JSON.stringify(logged);
    expect(text).toContain('"status":422');
    expect(text).toContain(STUDENT);
    expect(text).not.toContain("0001@home.example");
  });
});

describe("lyceon.entitled", () => {
  it('student and guardian payer: each gets entitled = "true" and one event', async () => {
    const { deps, calls } = harness([
      profile({ id: STUDENT }),
      profile({ id: GUARDIAN, role: "guardian", date_of_birth: null }),
    ]);
    expect(
      await sendEntitledEvents(
        { studentProfileId: STUDENT, payerProfileId: GUARDIAN },
        deps,
      ),
    ).toEqual(["sent", "sent"]);
    expect(eventsOf(calls).map((c) => c.body)).toEqual([
      { event: ENTITLED_EVENT, email: "0001@home.example", payload: {} },
      { event: ENTITLED_EVENT, email: "0002@home.example", payload: {} },
    ]);
    const props = calls
      .filter((c) => c.body && "properties" in c.body)
      .map((c) => c.body?.properties);
    expect(props).toContainEqual({ role: "student", entitled: "true" });
    expect(props).toContainEqual({ role: "guardian", entitled: "true" });
  });

  it("self-paid (no payer, or the payer is the student): only the student", async () => {
    for (const payer of [null, STUDENT]) {
      const { deps, calls } = harness([profile({ id: STUDENT })]);
      expect(
        await sendEntitledEvents(
          { studentProfileId: STUDENT, payerProfileId: payer },
          deps,
        ),
      ).toEqual(["sent"]);
      expect(eventsOf(calls)).toHaveLength(1);
    }
  });

  it("an under-13 student is skipped; the guardian who paid still gets it", async () => {
    const { deps, calls } = harness([
      profile({ id: STUDENT, date_of_birth: "2016-03-03" }),
      profile({ id: GUARDIAN, role: "guardian", date_of_birth: null }),
    ]);
    expect(
      await sendEntitledEvents(
        { studentProfileId: STUDENT, payerProfileId: GUARDIAN },
        deps,
      ),
    ).toEqual(["skipped", "sent"]);
    expect(eventsOf(calls).map((c) => c.body?.email)).toEqual([
      "0002@home.example",
    ]);
  });
});

describe("after-response sends are kept alive with waitUntil", () => {
  it("hands waitUntil a promise that settles only once the send has finished", async () => {
    let finish: () => void = () => undefined;
    let finished = false;
    fireLifecycle(
      "onboarded",
      STUDENT,
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            finished = true;
            resolve();
          };
        }),
    );
    expect(vercel.waitUntil).toHaveBeenCalledTimes(1);
    const kept = vercel.waitUntil.mock.calls[0]?.[0];
    expect(kept).toBeInstanceOf(Promise);
    let settled = false;
    void kept?.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false); // still waiting on the send
    finish();
    await kept;
    expect(finished).toBe(true);
    expect(settled).toBe(true);
  });

  it("a send that throws still settles the kept promise, and is logged without content", async () => {
    fireLifecycle("entitled", STUDENT, async () => {
      throw new TypeError("boom 0001@home.example");
    });
    const kept = vercel.waitUntil.mock.calls[0]?.[0];
    await expect(kept).resolves.toBeUndefined();
    const text = JSON.stringify(logged);
    expect(text).toContain("unexpected_failure");
    expect(text).toContain("TypeError");
    expect(text).not.toContain("0001@home.example");
  });
});
