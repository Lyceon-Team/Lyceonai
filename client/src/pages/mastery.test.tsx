// @vitest-environment jsdom
/**
 * UI-57: Mastery (`/mastery`), paid and free, rendered in the real App shell.
 *
 * @spec [student-UI register UI-57; register §2 (mastery is paid: `mastery_detail`; the free slot
 *        is the locked card; `mastery_level` only, no raw accuracy anywhere — Step 2 ruling 6,
 *        SCL-186; no confidence or vanity metrics); DESIGN.md §1 (one primary action), §3
 *        (Mastery row, Locked mastery card), §4 "Not prototyped" (domain grid with mastery rows,
 *        then the skills list per domain); evidence/wiring-table.md §13; OQ-29; owner ruling
 *        2026-08-20 RULE 1, 5, 6; owner ruling 2026-08-27 (one flat skills fetch)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the page is mounted with the real query layer, the real App shell (no panel, no
 * footer, as the route table gives /mastery), the real upgrade modal and a scripted network
 * standing in for `csrfFetch`. Every request is logged, so "this element reads that endpoint" and
 * "the free page asks for nothing" are asserted from the log.
 *
 * FIXTURES FROM REAL PRODUCERS. The two mastery bodies are the route's own composition — the real
 * `readDomainMasteryView` and `readSkillCatalogView`, wrapped in the route's `{ ok: true, … }`
 * envelope and parsed by the shared response schemas — with only the database answer under them
 * faked: `mastery_levels` (the six seeded rows), `student_domain_mastery`, `student_skill_mastery`
 * and `canonical_skill_catalog` (the canonical taxonomy, `canonicalCatalogRows`). The 402 is the
 * route's own `sendPaymentRequired`. The feature-access map is `resolveFeatureAccess`'s output.
 *
 * PRESENCE BEFORE ABSENCE. The faked database rows carry the admin-only columns the mastery tables
 * hold beside `mastery_level` (a score, a percentage, an event count) and the accuracy and answer
 * counts a leak would show. The real readers do not select them and the real builders do not copy
 * them, so the served body has none — asserted, not assumed. A second case serves a body that DOES
 * carry them (a producer regression), proves the JSON on the wire holds them, and then proves the
 * page shows none of them.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import {
  masteryDomainsResponseSchema,
  masterySkillsResponseSchema,
} from "@lyceon/shared/mastery-levels";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { UPGRADE_MODAL_COPY } from "@/components/billing/upgrade-modal";
import { AppShell } from "@/components/layout/app-shell";
import { canonicalCatalogRows } from "@/components/student-ui/filter-bar/topics.fixture";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { getQueryFn } from "@/lib/queryClient";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";
import { sendPaymentRequired } from "../../../server/lib/http-errors";
import {
  readDomainMasteryView,
  readSkillCatalogView,
} from "../../../apps/api/src/services/mastery-view";
import { MASTERY_LEVEL_FIXTURE } from "../../../tests/utils/mastery-levels-fixture";
import {
  masteryDomainAnchorId,
  masteryDomainHref,
} from "@/components/mastery/domain-nodes";
import MasteryPage from "./mastery";

// ── The network ────────────────────────────────────────────────────────────────────────────

const net = vi.hoisted(() => ({
  log: [] as string[],
  answer: (_url: string): Response | undefined => undefined,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    net.log.push(`${init?.method ?? "GET"} ${url}`);
    const answer = net.answer(url);
    if (answer !== undefined) return answer;
    if (url.startsWith("/api/notifications")) {
      return json({ data: { unread: 0 }, requestId: "r" });
    }
    return json({ error: "Not found" }, 404);
  },
}));

const STUDENT = "00000000-0000-4000-8000-000000000057";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "00000000-0000-4000-8000-000000000057",
      email: "sam@example.test",
      display_name: "Sam Rivera",
      role: "student",
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isAdmin: false,
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));

// ── The database under the real readers ────────────────────────────────────────────────────

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
}));

/** A PostgREST-ish chain: select → eq/order … → awaited. Filters are ignored (one student). */
function chain(rows: unknown[]): Record<string, unknown> {
  const result = Promise.resolve({ data: rows, error: null });
  const node: Record<string, unknown> = {
    eq: () => node,
    order: () => node,
    then: result.then.bind(result),
  };
  return node;
}

vi.mock("../../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const rows = db.tables[table];
      if (rows === undefined) throw new Error(`unexpected table ${table}`);
      return { select: () => chain(rows) };
    },
  }),
}));
vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in this test");
    },
    from: () => {
      throw new Error("no database in this test");
    },
  },
}));
const entitlement = vi.hoisted(() => ({ paid: false }));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

/** What a leak would show: admin-only columns, an accuracy and answer counts. */
const LEAKY = {
  mastery_score: 0.72,
  mastery_pct: 72,
  event_count_total: 25,
  accuracy: 0.72,
  correct: 18,
  attempted: 25,
} as const;

/**
 * `student_domain_mastery` for the student. Problem Solving and Data Analysis has NO row (the
 * page must still draw it); Geometry and Standard English Conventions are NULL (unmeasured).
 */
const DOMAIN_ROWS = [
  { section: "M", domain: "Algebra", mastery_level: 2, ...LEAKY },
  { section: "M", domain: "Advanced Math", mastery_level: 0, ...LEAKY },
  {
    section: "M",
    domain: "Geometry and Trigonometry",
    mastery_level: null,
    ...LEAKY,
  },
  {
    section: "RW",
    domain: "Information and Ideas",
    mastery_level: 4,
    ...LEAKY,
  },
  { section: "RW", domain: "Craft and Structure", mastery_level: 1, ...LEAKY },
  { section: "RW", domain: "Expression of Ideas", mastery_level: 3, ...LEAKY },
  {
    section: "RW",
    domain: "Standard English Conventions",
    mastery_level: null,
    ...LEAKY,
  },
];

/** `student_skill_mastery`: three Algebra skills measured, the other two have no row. */
const SKILL_ROWS = [
  {
    section: "M",
    domain: "Algebra",
    skill: "Linear Equations in One Variable",
    mastery_level: 3,
    computed_at: "2026-10-01T00:00:00Z",
    ...LEAKY,
  },
  {
    section: "M",
    domain: "Algebra",
    skill: "Linear Functions",
    mastery_level: 1,
    computed_at: "2026-10-01T00:00:00Z",
    ...LEAKY,
  },
  {
    section: "M",
    domain: "Algebra",
    skill: "Systems of Two Linear Equations in Two Variables",
    mastery_level: 0,
    computed_at: "2026-10-01T00:00:00Z",
    ...LEAKY,
  },
  {
    section: "RW",
    domain: "Craft and Structure",
    skill: "Words in Context",
    mastery_level: 2,
    computed_at: "2026-10-01T00:00:00Z",
    ...LEAKY,
  },
];

/** `mastery_levels` as migration 20260820000000 seeds it. */
function levelRows(): unknown[] {
  return MASTERY_LEVEL_FIXTURE.map((l, i) => ({
    level_key: l.levelKey,
    level: l.level,
    display_name: l.displayName,
    sort_order: i,
  }));
}

function installDb(args: {
  domains?: unknown[];
  skills?: unknown[];
  catalog?: unknown[];
}): void {
  db.tables = {
    mastery_levels: levelRows(),
    student_domain_mastery: args.domains ?? DOMAIN_ROWS,
    student_skill_mastery: args.skills ?? SKILL_ROWS,
    canonical_skill_catalog: args.catalog ?? canonicalCatalogRows(),
  };
}

/** GET …/mastery/domains as the route sends it (`student-resources.ts`, mastery section). */
async function domainsBody(): Promise<unknown> {
  const { domains } = await readDomainMasteryView({
    studentId: STUDENT,
    section: undefined,
  });
  return masteryDomainsResponseSchema.parse({
    ok: true,
    domains,
    requestId: "r",
  });
}

/** GET …/mastery/skills as the route sends it. */
async function skillsBody(): Promise<unknown> {
  const view = await readSkillCatalogView({ studentId: STUDENT });
  return masterySkillsResponseSchema.parse({
    ok: true,
    ...view,
    requestId: "r",
  });
}

/** The route's own 402 for `mastery_detail`. */
function denialBody(): { status: number; body: unknown } {
  const served = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      served.status = code;
      return res;
    },
    json(body: unknown) {
      served.body = body;
      return res;
    },
  };
  sendPaymentRequired(res as never, "mastery_detail", "r");
  return served;
}

const DOMAINS_URL = `/api/students/${STUDENT}/mastery/domains`;
const SKILLS_URL = `/api/students/${STUDENT}/mastery/skills`;

type Served = { domains: unknown; skills: unknown; status?: number };

function serve(bodies: Served): void {
  net.answer = (url) => {
    const path = url.split("?")[0];
    if (path === DOMAINS_URL) return json(bodies.domains, bodies.status ?? 200);
    if (path === SKILLS_URL) return json(bodies.skills, bodies.status ?? 200);
    return undefined;
  };
}

async function accessMap(paid: boolean): Promise<FeatureAccessMap> {
  entitlement.paid = paid;
  const map = await resolveFeatureAccess({
    id: STUDENT,
    role: "student",
    is_under_13: false,
  });
  if (map === null) throw new Error("a student always gets a map");
  return map;
}

// ── Mount ──────────────────────────────────────────────────────────────────────────────────

async function mount(
  plan: "paid" | "free",
  path = "/mastery",
): Promise<HTMLElement> {
  const map = await accessMap(plan === "paid");
  const { hook, searchHook } = memoryLocation({ path });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        retry: false,
        staleTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
  client.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: map,
    user: null,
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <Router hook={hook} searchHook={searchHook}>
        <UpgradeModalProvider autoOpenOnDenial>
          <AppShell panel={null} footer={false}>
            <MasteryPage />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  await screen.findByTestId("mastery");
  return container;
}

function masteryGets(): string[] {
  return net.log
    .filter((l) => l.startsWith("GET ") && l.includes("/mastery/"))
    .map((l) => l.slice(4).split("?")[0] ?? "");
}

function domainRow(domain: string): HTMLElement {
  const block = document.querySelector<HTMLElement>(
    `[data-testid="mastery-domain"][data-domain="${domain}"]`,
  );
  if (block === null) throw new Error(`no domain block for ${domain}`);
  return within(block).getAllByTestId("mastery-row")[0] as HTMLElement;
}

function filledSegments(row: HTMLElement): number {
  return row.querySelectorAll('[data-segment][data-filled="true"]').length;
}

function pill(row: HTMLElement): HTMLElement {
  return within(row).getByTestId("level-pill");
}

/** The filled primary actions on screen (DESIGN.md §1: at most one). */
function primaries(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("a, button")).filter(
    (el) => el.className.includes("bg-lyc-primary-bg"),
  );
}

beforeEach(() => {
  net.log.length = 0;
  net.answer = () => undefined;
  installDb({});
});

afterEach(() => {
  cleanup();
});

// ── Paid ───────────────────────────────────────────────────────────────────────────────────

describe("Mastery, paid (featureAccess grants mastery_detail)", () => {
  it("draws the eight domains in canonical order, grouped by section, from /mastery/domains", async () => {
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("paid");
    await screen.findAllByTestId("mastery-domain");

    const sections = screen.getAllByTestId("mastery-section");
    expect(
      sections.map(
        (s) => within(s).getByRole("heading", { level: 2 }).textContent,
      ),
    ).toEqual(["Math", "Reading & Writing"]);
    const domainsIn = (s: HTMLElement): string[] =>
      within(s)
        .getAllByTestId("mastery-domain")
        .map((d) => d.getAttribute("data-domain") ?? "");
    // Written out, not read from the constant the page uses: the server's order.
    expect(domainsIn(sections[0] as HTMLElement)).toEqual([
      "Algebra",
      "Advanced Math",
      "Problem Solving and Data Analysis",
      "Geometry and Trigonometry",
    ]);
    expect(domainsIn(sections[1] as HTMLElement)).toEqual([
      "Craft and Structure",
      "Information and Ideas",
      "Standard English Conventions",
      "Expression of Ideas",
    ]);
    // Both reads, once each (one flat skills fetch, owner ruling 2026-08-27).
    expect(masteryGets().sort()).toEqual([DOMAINS_URL, SKILLS_URL].sort());
  });

  it("each domain row shows the served level's pill and fills segments to mastery_level", async () => {
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("paid");
    await screen.findAllByTestId("mastery-domain");

    const expected: Array<[string, string, string, number]> = [
      ["Algebra", "L2", "Developing", 3],
      ["Advanced Math", "L0", "Foundations", 1],
      ["Information and Ideas", "L4", "Strong", 5],
      ["Craft and Structure", "L1", "Building", 2],
      ["Expression of Ideas", "L3", "Proficient", 4],
    ];
    for (const [domain, key, name, filled] of expected) {
      const row = domainRow(domain);
      expect(row.getAttribute("data-level-key"), domain).toBe(key);
      expect(pill(row).textContent, domain).toBe(name);
      expect(filledSegments(row), domain).toBe(filled);
      expect(
        within(row).getByRole("img").getAttribute("aria-label"),
        domain,
      ).toBe(`Mastery: ${name}, level ${filled} of 5`);
    }
  });

  it("an unmeasured domain (NULL, or missing from the payload) shows the dashed 'Not enough answers yet' pill and empty segments", async () => {
    // The real builder fills a domain with no database row as unmeasured, so a real body always
    // carries all eight. A SHORT body (a regression) is made by dropping one served domain; the
    // page must still draw it, unmeasured, from the canonical list.
    const body = masteryDomainsResponseSchema.parse(await domainsBody());
    expect(body.domains).toHaveLength(8);
    const psda = body.domains.find(
      (d) => d.domain === "Problem Solving and Data Analysis",
    );
    expect(psda?.levelKey).toBe("unmeasured");
    const short = {
      ...body,
      domains: body.domains.filter((d) => d !== psda),
    };
    expect(short.domains).toHaveLength(7);
    serve({ domains: short, skills: await skillsBody() });
    await mount("paid");
    await screen.findAllByTestId("mastery-domain");
    expect(screen.getAllByTestId("mastery-domain")).toHaveLength(8);

    for (const domain of [
      "Problem Solving and Data Analysis", // missing from the payload
      "Geometry and Trigonometry", // NULL
      "Standard English Conventions", // NULL
    ]) {
      const row = domainRow(domain);
      expect(row.getAttribute("data-level-key"), domain).toBe("unmeasured");
      expect(pill(row).textContent, domain).toBe("Not enough answers yet");
      expect(pill(row).className, domain).toContain("border-dashed");
      expect(row.querySelectorAll("[data-segment]").length, domain).toBe(5);
      expect(filledSegments(row), domain).toBe(0);
    }
  });

  it("opening a domain lists ITS skills from /mastery/skills, each with its own level; an unmeasured skill reads 'Not enough answers yet'", async () => {
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("paid");
    await screen.findAllByTestId("mastery-domain");

    const algebra = domainRow("Algebra");
    expect(algebra.tagName).toBe("BUTTON");
    expect(algebra.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("skill-list")).toBeNull();

    fireEvent.click(algebra);
    expect(algebra.getAttribute("aria-expanded")).toBe("true");
    const list = await screen.findByTestId("skill-list");
    expect(algebra.getAttribute("aria-controls")).toBe(list.parentElement?.id);
    const rows = within(list).getAllByTestId("mastery-row");
    const read = rows.map((r) => [
      r.textContent?.replace(pill(r).textContent ?? "", "") ?? "",
      r.getAttribute("data-level-key"),
      pill(r).textContent,
      filledSegments(r),
    ]);
    // The canonical tree's five Algebra skills, sorted as the server sorts them.
    expect(read).toEqual([
      ["Linear Equations in One Variable", "L3", "Proficient", 4],
      [
        "Linear Equations in Two Variables",
        "unmeasured",
        "Not enough answers yet",
        0,
      ],
      ["Linear Functions", "L1", "Building", 2],
      [
        "Linear Inequalities in One or Two Variables",
        "unmeasured",
        "Not enough answers yet",
        0,
      ],
      [
        "Systems of Two Linear Equations in Two Variables",
        "L0",
        "Foundations",
        1,
      ],
    ]);
    for (const r of rows.filter(
      (x) => x.getAttribute("data-level-key") === "unmeasured",
    )) {
      expect(pill(r).className).toContain("border-dashed");
    }
    // Another domain's skill is not in this list.
    expect(within(list).queryByText("Words in Context")).toBeNull();
    // RULE 6: one outline call to action for the opened domain, because something is unmeasured.
    expect(
      within(list).getAllByRole("link", { name: "Practice Algebra" }),
    ).toHaveLength(1);
    // OQ-58 (Karl, 2026-10-05): US spelling. The British form appears nowhere on the page.
    expect(document.body.textContent ?? "").not.toMatch(/practis/i);

    // A second domain opens from the same fetch: no further request.
    fireEvent.click(domainRow("Craft and Structure"));
    await waitFor(() =>
      expect(screen.getAllByTestId("skill-list")).toHaveLength(2),
    );
    expect(screen.getByText("Words in Context")).toBeTruthy();
    expect(masteryGets().filter((u) => u === SKILLS_URL)).toHaveLength(1);

    // Closing hides the list again.
    fireEvent.click(algebra);
    expect(algebra.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByTestId("skill-list")).toHaveLength(1);
  });

  it("the served payload carries mastery_level only: the database rows' accuracy, counts and scores never reach the wire", async () => {
    // Presence: the rows under the readers DO carry them.
    for (const row of [...DOMAIN_ROWS, ...SKILL_ROWS]) {
      expect(row).toMatchObject(LEAKY);
    }
    const wire = JSON.stringify([await domainsBody(), await skillsBody()]);
    // The bodies are non-trivial (eight domains, 29 skills) …
    expect(wire).toContain('"levelKey":"L2"');
    expect(wire).toContain("Linear Equations in One Variable");
    // … and hold none of them.
    for (const field of Object.keys(LEAKY)) {
      expect(wire).not.toContain(`"${field}"`);
    }
  });

  it("shows no %, no accuracy and no answer counts anywhere, even if a producer regression sent them", async () => {
    const domains = (await domainsBody()) as { domains: object[] };
    const skills = (await skillsBody()) as { skills: object[] };
    const leaked = {
      domains: {
        ...domains,
        domains: domains.domains.map((d) => ({ ...d, ...LEAKY })),
      },
      skills: {
        ...skills,
        skills: skills.skills.map((s) => ({ ...s, ...LEAKY })),
      },
    };
    // Presence: the JSON on the wire carries every leaky field.
    const wire = JSON.stringify(leaked);
    for (const field of Object.keys(LEAKY))
      expect(wire).toContain(`"${field}"`);
    serve(leaked);
    const container = await mount("paid");
    await screen.findAllByTestId("mastery-domain");
    // Open every domain so every skill row is on screen.
    for (const block of screen.getAllByTestId("mastery-domain")) {
      fireEvent.click(
        within(block).getAllByTestId("mastery-row")[0] as HTMLElement,
      );
    }
    await waitFor(() =>
      expect(screen.getAllByTestId("skill-list")).toHaveLength(8),
    );
    expect(screen.getAllByTestId("mastery-row").length).toBe(8 + 29);

    const text = container.ownerDocument.body.textContent ?? "";
    expect(text).toContain("Developing"); // the page rendered the data around it
    expect(text).not.toContain("%");
    expect(text).not.toMatch(/\d/);
    expect(text.toLowerCase()).not.toMatch(
      /accura|correct|attempt|confiden|predict|score/,
    );
    const labels = Array.from(
      container.ownerDocument.querySelectorAll("[aria-label]"),
    ).map((el) => el.getAttribute("aria-label") ?? "");
    for (const label of labels) {
      expect(label).not.toContain("%");
      expect(label).not.toMatch(/\b(18|25|72)\b/);
    }
  });

  it("nothing measured: one 'Start practicing', the screen's one primary action", async () => {
    installDb({ domains: [], skills: [] });
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("paid");
    await screen.findAllByTestId("mastery-domain");
    const cta = screen.getByTestId("grid-cta");
    expect(
      within(cta)
        .getByRole("link", { name: "Start practicing" })
        .getAttribute("href"),
    ).toBe("/practice");
    // OQ-58 (Karl, 2026-10-05): US spelling. The British form appears nowhere on the page.
    expect(document.body.textContent ?? "").not.toMatch(/practis/i);
    expect(primaries()).toHaveLength(1);
  });

  it("something measured: no grid call to action and no primary action at all", async () => {
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("paid");
    await screen.findAllByTestId("mastery-domain");
    expect(screen.queryByTestId("grid-cta")).toBeNull();
    fireEvent.click(domainRow("Algebra"));
    await screen.findByTestId("skill-list");
    expect(primaries()).toHaveLength(0);
  });

  it("an empty catalogue for a domain says so, distinct from a failed skills read", async () => {
    installDb({
      catalog: canonicalCatalogRows().filter(
        (r) => r.domain !== "Advanced Math",
      ),
      skills: SKILL_ROWS,
    });
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("paid");
    await screen.findAllByTestId("mastery-domain");
    fireEvent.click(domainRow("Advanced Math"));
    expect((await screen.findByTestId("catalog-empty")).textContent).toContain(
      "There are no published questions in this domain yet",
    );
    expect(screen.queryByTestId("skills-error")).toBeNull();
  });

  it("a failed domains read shows the error notice with Try again, not an empty grid", async () => {
    net.answer = (url) =>
      url.split("?")[0] === DOMAINS_URL || url.split("?")[0] === SKILLS_URL
        ? json({ error: "Internal server error", requestId: "r" }, 500)
        : undefined;
    await mount("paid");
    // The page retries a failed read once (about a second later) before showing the notice.
    const notice = await screen.findByTestId(
      "mastery-error",
      {},
      { timeout: 4000 },
    );
    expect(notice.textContent).toContain("We couldn't load mastery data.");
    expect(
      within(notice).getByRole("button", { name: "Try again" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("mastery-domain")).toBeNull();
  });

  it("the interim chrome is gone: no in-body Back, no eyebrow, no separate skills screen", async () => {
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("paid");
    await screen.findAllByTestId("mastery-domain");
    expect(
      screen.getByRole("heading", { level: 1, name: "Your mastery" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Back$/ })).toBeNull();
    expect(screen.queryByTestId("page-header-eyebrow")).toBeNull();
    fireEvent.click(domainRow("Algebra"));
    await screen.findByTestId("skill-list");
    expect(screen.queryByText("All domains")).toBeNull();
    // The domain grid stays on screen while a domain is open.
    expect(screen.getAllByTestId("mastery-domain")).toHaveLength(8);
  });
});

// ── Free and refused ───────────────────────────────────────────────────────────────────────

describe("Mastery, free (featureAccess locks mastery_detail)", () => {
  it("shows the locked card and makes no mastery request", async () => {
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("free");
    const card = await screen.findByTestId("locked-mastery-card");
    expect(
      within(card).getByRole("heading", {
        name: "Track mastery by domain and skills",
      }),
    ).toBeTruthy();
    // Empty outlines only: no level, no name, no filled segment.
    expect(card.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
    expect(within(card).queryByTestId("level-pill")).toBeNull();
    expect(screen.queryByTestId("mastery-domain")).toBeNull();
    // The page made requests (the shell's), but none to the gated reads.
    expect(net.log.length).toBeGreaterThan(0);
    expect(masteryGets()).toEqual([]);
  });

  it("'See what's included' opens the upgrade modal for mastery_detail", async () => {
    await mount("free");
    const card = await screen.findByTestId("locked-mastery-card");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
    fireEvent.click(
      within(card).getByRole("button", { name: "See what's included" }),
    );
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(
      UPGRADE_MODAL_COPY.mastery_detail.plan.title,
    );
    expect(masteryGets()).toEqual([]);
  });

  it("a server 402 for mastery_detail still draws the locked state (and the app's modal opens, UI-44)", async () => {
    const denial = denialBody();
    expect(denial.status).toBe(402);
    expect(denial.body).toMatchObject({
      code: "entitlement_required",
      details: { feature: "mastery_detail" },
    });
    serve({ domains: denial.body, skills: denial.body, status: denial.status });
    // The map says granted (stale), the server refuses: the server wins.
    await mount("paid");
    expect(await screen.findByTestId("locked-mastery-card")).toBeTruthy();
    expect(screen.queryByTestId("mastery-error")).toBeNull();
    expect(screen.queryByTestId("mastery-domain")).toBeNull();
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(
      UPGRADE_MODAL_COPY.mastery_detail.plan.title,
    );
  });
});

// ── Owner QA list (Karl, 2026-10-07) item 14 ──────────────────────────────────────────────────

describe("QA item 14: a domain address opens that domain and scrolls to it", () => {
  it("/mastery?domain=M:Advanced Math (Home's row link) opens Advanced Math and scrolls it into view", async () => {
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      await mount(
        "paid",
        masteryDomainHref({ section: "M", domain: "Advanced Math" }),
      );
      await screen.findAllByTestId("mastery-domain");
      // Presence: the other rows are closed, so "open" is this address's doing.
      expect(domainRow("Algebra").getAttribute("aria-expanded")).toBe("false");
      expect(domainRow("Advanced Math").getAttribute("aria-expanded")).toBe(
        "true",
      );
      await screen.findByTestId("skill-list");
      const block = screen
        .getAllByTestId("mastery-domain")
        .find((b) => b.getAttribute("data-domain") === "Advanced Math");
      expect(block?.id).toBe(masteryDomainAnchorId("M:Advanced Math"));
      await waitFor(() => expect(scrolled).toEqual([block?.id]));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("an unknown domain in the address opens nothing", async () => {
    serve({ domains: await domainsBody(), skills: await skillsBody() });
    await mount("paid", "/mastery?domain=M%3ANot%20a%20domain");
    const rows = await screen.findAllByTestId("mastery-domain");
    expect(rows.length).toBe(8);
    for (const row of rows) {
      expect(
        within(row).getAllByRole("button")[0]?.getAttribute("aria-expanded"),
      ).toBe("false");
    }
  });
});
