// @vitest-environment jsdom
/**
 * G5-03 — the Dashboard's mastery card (ruling R13: guardian-only, follows the design).
 *
 * @spec [Guardian_Closure_Plan G5-03, R13 (Karl, 2026-10-02); owner ruling 2026-08-20 RULE 1
 *       (level names from `mastery_levels`) and RULE 3 (unmeasured is its own state); owner
 *       decision 2026-10-01 (always the eight domains); SCL-194 (no skills)]
 *       | @implemented [2026-10-02]
 *
 * plain English: the real app at `/guardian/:id`, served the shared scenario's mastery (four
 * of the eight domains have rows). The card draws two columns by section, in the canonical
 * order, every domain as one row: its name, a five-segment meter, the server's level name in a
 * pill on the right. A domain without a row reads "Not enough answers yet" with an empty
 * meter. Colours are the live `levelTone`: the pill carries the level's classes, a filled
 * segment the pill's text tone. The legend lists exactly the levels on the page, in level
 * order. Nothing skill-related, and the student `DomainGrid` is not used here.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_DOMAINS_BY_SECTION } from "@shared/canonical-domains";
import { levelTone } from "@/components/mastery/LevelPill";
import { ADA, mountApp, net, roster, serveDashboard } from "./test-harness";

vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const { GUARDIAN_AUTH: auth } = await import("./test-harness");
  return {
    useSupabaseAuth: () => ({ ...auth, signOut: vi.fn(async () => undefined) }),
  };
});
vi.mock("@/lib/csrf", async () => {
  const { scriptedFetch: fetcher } = await import("./test-harness");
  return {
    getCsrfToken: vi.fn(async () => "t"),
    clearCsrfToken: vi.fn(),
    csrfFetch: vi.fn(fetcher),
  };
});

const { Router } = await import("@/App");

beforeEach(() => {
  net.reset();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
  net.handlers.push(serveDashboard(ADA));
});
afterEach(cleanup);

async function card(): Promise<HTMLElement> {
  mountApp(Router, `/guardian/${ADA}`);
  return screen.findByTestId("mastery-card");
}

const row = (root: HTMLElement, domain: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-domain="${domain}"]`);
  if (el === null) throw new Error(`no row for ${domain}`);
  return el;
};

/** The scenario's served rows (test-harness `masteryDomains`); the other four have none. */
const SERVED = {
  "Craft and Structure": { key: "L3", name: "Proficient", fill: 4 },
  "Expression of Ideas": { key: "L2", name: "Developing", fill: 3 },
  Algebra: { key: "L4", name: "Strong", fill: 5 },
  "Advanced Math": {
    key: "unmeasured",
    name: "Not enough answers yet",
    fill: 0,
  },
} as const;

describe("G5-03 the mastery card", () => {
  it("two columns by section, all eight domains in canonical order", async () => {
    const root = await card();
    expect(root).toHaveTextContent("Mastery by domain");
    for (const [section, label] of [
      ["RW", "Reading and Writing"],
      ["M", "Math"],
    ] as const) {
      const column = within(root).getByTestId(`mastery-column-${section}`);
      expect(column).toHaveTextContent(label);
      expect(
        within(column)
          .getAllByTestId("mastery-row")
          .map((r) => r.getAttribute("data-domain")),
      ).toEqual([...CANONICAL_DOMAINS_BY_SECTION[section]]);
    }
  });

  it("each row: the server's level name in a levelTone pill and a matching meter", async () => {
    const root = await card();
    for (const section of ["RW", "M"] as const) {
      for (const domain of CANONICAL_DOMAINS_BY_SECTION[section]) {
        const served = (
          SERVED as Record<string, (typeof SERVED)[keyof typeof SERVED]>
        )[domain];
        const key = served?.key ?? "unmeasured";
        const name = served?.name ?? "Not enough answers yet";
        const fill = served?.fill ?? 0;
        const r = row(root, domain);
        expect(r).toHaveTextContent(domain);
        const pill = within(r).getByTestId("mastery-pill");
        expect(pill).toHaveTextContent(new RegExp(`^${name}$`));
        expect(pill.getAttribute("data-level-key")).toBe(key);
        const tone = levelTone(key).split(" ");
        for (const c of tone.filter((t) => !t.startsWith("border-"))) {
          expect(pill.className.split(" ")).toContain(c);
        }
        const meter = within(r).getByTestId("mastery-row-meter");
        expect(meter.getAttribute("aria-label")).toBe(
          `Mastery: ${name}, ${fill} of 5`,
        );
        const segments = Array.from(
          meter.querySelectorAll<HTMLElement>("[data-segment]"),
        );
        expect(segments).toHaveLength(5);
        const ink = tone.find((t) => t.startsWith("text-"));
        segments.forEach((s, i) => {
          expect(s.getAttribute("data-filled")).toBe(
            i < fill ? "true" : "false",
          );
          if (i < fill) expect(s.className.split(" ")).toContain(ink);
        });
      }
    }
  });

  it("the legend lists exactly the levels on the page, in level order", async () => {
    const root = await card();
    const legend = within(root).getByTestId("mastery-legend");
    expect(
      within(legend)
        .getAllByTestId("mastery-legend-item")
        .map((i) => i.textContent),
    ).toEqual(["Developing", "Proficient", "Strong", "Not enough answers yet"]);
  });

  it("no skills and no student grid on the guardian card", async () => {
    const root = await card();
    expect(within(root).queryByRole("button")).toBeNull();
    expect(root).not.toHaveTextContent(/skills/i);
    expect(screen.queryByTestId("domain-grid")).toBeNull();
    expect(net.log.some((l) => l.includes("/mastery/skills"))).toBe(false);
  });
});
