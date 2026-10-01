// @vitest-environment jsdom
/**
 * Guardians see no skills, anywhere: the Dashboard, the exam list and the exam detail.
 *
 * @spec [owner ruling 2026-10-01 (#1013 review, item 2: "Guardians see no skills, anywhere");
 *       SCL-194; Doc 05A :73 (no guardian read of `student_skill_mastery`); Doc 05 Parent
 *       criterion #19] | @implemented [2026-10-01]
 *
 * plain English: mounts the real app routes as a guardian and serves every guardian read —
 * AND answers any `…/mastery/skills` request with a full skill list, as bait. Then, on each
 * page, presence first (the page really rendered its content), and absence: none of the
 * question bank's skill names in the text, no link whose target names a skill, no control
 * named "Skills", no element whose test id names a skill, and no skills request at all.
 *
 * WHERE THE SKILL NAMES COME FROM. The question bank's own batch manifests
 * (`content/canonical/batch_manifests/*.json`, `target_skills`) — the 29 names the canonical
 * skill catalog is built from — never a typed-in list that could miss one.
 */
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
  EXAM_SESSION,
  json,
  mountApp,
  net,
  roster,
  serveDashboard,
} from "./test-harness";

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

const MANIFESTS = "content/canonical/batch_manifests";
const SKILL_NAMES: readonly string[] = [
  ...new Set(
    fs
      .readdirSync(MANIFESTS)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f): string[] => {
        const parsed: unknown = JSON.parse(
          fs.readFileSync(path.join(MANIFESTS, f), "utf8"),
        );
        const skills =
          parsed !== null &&
          typeof parsed === "object" &&
          "target_skills" in parsed
            ? parsed.target_skills
            : [];
        return Array.isArray(skills)
          ? skills.filter((s): s is string => typeof s === "string")
          : [];
      }),
  ),
].sort();

/** The bait: a full skill list, served to any `…/mastery/skills` request. */
function serveSkillsBait(url: string): Response | undefined {
  if (!url.endsWith("/mastery/skills")) return undefined;
  return json({
    ok: true,
    catalogEmpty: false,
    skills: SKILL_NAMES.map((skill) => ({
      section: "M",
      domain: "Algebra",
      skill,
      levelKey: "L2",
      level: 2,
      displayName: "Developing",
    })),
    requestId: "r",
  });
}

beforeEach(() => {
  net.reset();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
  net.handlers.push(serveSkillsBait);
  net.handlers.push(serveDashboard(ADA));
});
afterEach(cleanup);

function expectNoSkills(): void {
  const text = document.body.textContent ?? "";
  // No skill name, whole name, case-insensitive.
  const named = SKILL_NAMES.filter((s) =>
    text.toLowerCase().includes(s.toLowerCase()),
  );
  expect(named).toEqual([]);
  // No skill link, no Skills control, no skill-named element.
  const skillLinks = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => /skill/i.test(href));
  expect(skillLinks).toEqual([]);
  expect(screen.queryAllByRole("button", { name: /skill/i })).toEqual([]);
  expect(screen.queryAllByRole("link", { name: /skill/i })).toEqual([]);
  expect(document.querySelectorAll("[data-testid*='skill' i]")).toHaveLength(0);
  expect(screen.queryAllByTestId("domain-open")).toEqual([]);
  expect(text).not.toMatch(/\bskills?\b/i);
  // And the page never asked for them.
  expect(net.log.filter((l) => /skill/i.test(l))).toEqual([]);
}

describe("guardians see no skills (owner ruling 2026-10-01, SCL-194)", () => {
  it("the skill names are the question bank's, and the bait carries them", () => {
    // Presence before absence: a list this size cannot be vacuous.
    expect(SKILL_NAMES.length).toBe(29);
    expect(SKILL_NAMES).toContain("Linear Equations in One Variable");
    expect(SKILL_NAMES).toContain("Words in Context");
  });

  it("the Dashboard: eight domain cards, and no skill anywhere", async () => {
    mountApp(Router, `/guardian/${ADA}`);
    await screen.findByTestId("dashboard-header");
    const grids = await screen.findAllByTestId("domain-grid");
    await screen.findByTestId("dashboard-exam");
    // Presence: both sections' grids, all eight domains, each with its meter.
    expect(grids).toHaveLength(2);
    expect(document.querySelectorAll("[data-domain]")).toHaveLength(8);
    expect(screen.getAllByTestId("mastery-meter")).toHaveLength(8);
    expectNoSkills();
  });

  it("the exam list: the test is listed, and no skill anywhere", async () => {
    mountApp(Router, `/guardian/${ADA}/exams`);
    const list = await screen.findByTestId("guardian-exam-list");
    expect(list.textContent).toContain("Practice Test 2");
    expectNoSkills();
  });

  it("the exam detail: the total and a bar per domain, and no skill anywhere", async () => {
    mountApp(Router, `/guardian/${ADA}/exams/${EXAM_SESSION}`);
    expect(await screen.findByTestId("exam-total-score")).toBeTruthy();
    expectNoSkills();
    fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
    expect(screen.getAllByTestId("exam-domain-row").length).toBeGreaterThan(0);
    expectNoSkills();
  });
});
