/**
 * The social funnel's rules: /start, its tagged links and the copy that points at it. What a
 * sign-up records from those tags is the sign-up attribution's (#1359) and tested there.
 *
 * @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
 *       (Karl, 2026-10-28) items 1, 2, 4; Karl's answer the same day ("Reword to what's free");
 *       Public Disclosure Doctrine 3 and 8] | @implemented [2026-10-28]
 *
 * plain English: the copy switches from the Dec 5 cohort line to the evergreen one the day after
 * the test, by the Chicago day; the cohort date is one College Board publishes; no line promises a free study plan (a paid-plan feature); /start is
 * prerendered but kept out of the sitemap and search indexes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAT_TEST_DATES } from "../../shared/sat-test-dates";
import { renderPageHead } from "../../shared/seo/head";
import { getPublicMeta } from "../../shared/seo/public-meta";
import { parseRouteRegistry } from "../../shared/seo/route-registry";
import {
  INSTAGRAM_COMMENT_CTA,
  START_COHORT_DATE,
  bioCtaLine,
  cohortDateLabel,
  funnelPhase,
  linkCtaLine,
  startHeadline,
  startLink,
} from "../../shared/social/funnel";

const ROOT = join(import.meta.dirname, "../..");

describe("the funnel copy", () => {
  it("the cohort date is a confirmed College Board date", () => {
    const entry = SAT_TEST_DATES.find((t) => t.date === START_COHORT_DATE);
    expect(entry?.status).toBe("confirmed");
    expect(entry?.source_url).toMatch(
      /^https:\/\/satsuite\.collegeboard\.org\//,
    );
    expect(cohortDateLabel()).toBe("Dec 5");
  });

  it("speaks to the Dec 5 cohort through test day, then turns evergreen (Chicago day)", () => {
    expect(funnelPhase("2026-10-28")).toBe("cohort");
    expect(funnelPhase("2026-12-05")).toBe("cohort");
    expect(funnelPhase("2026-12-06")).toBe("evergreen");
    expect(startHeadline("cohort")).toBe(
      "Taking the SAT Dec 5? Find your blind spots free before test day.",
    );
    expect(startHeadline("evergreen")).toBe("Find your SAT blind spots, free.");
  });

  it("the call-to-action lines", () => {
    expect(bioCtaLine("cohort")).toBe(
      "Taking the SAT Dec 5? Free SAT practice: link in bio",
    );
    expect(bioCtaLine("evergreen")).toBe("Free SAT practice: link in bio");
    expect(INSTAGRAM_COMMENT_CTA).toBe(
      "Comment SAT and I'll send you the link",
    );
    expect(linkCtaLine("cohort", "reddit", "qotd")).toBe(
      "Taking the SAT Dec 5? Free SAT practice: lyceon.ai/start?utm_source=reddit&utm_campaign=qotd",
    );
    expect(startLink("tiktok", "worked_example")).toBe(
      "lyceon.ai/start?utm_source=tiktok&utm_campaign=worked_example",
    );
  });

  it("no line promises a free study plan (the study calendar is a paid-plan feature)", () => {
    const lines = [
      ...(["cohort", "evergreen"] as const).flatMap((p) => [
        startHeadline(p),
        bioCtaLine(p),
        linkCtaLine(p, "reddit", "qotd"),
      ]),
      INSTAGRAM_COMMENT_CTA,
    ];
    expect(lines.length).toBeGreaterThan(0); // presence before absence
    for (const line of lines) expect(line).not.toMatch(/study plan|calendar/i);
  });
});

describe("/start", () => {
  it("is prerendered but not in the sitemap", () => {
    const rows = parseRouteRegistry(
      readFileSync(
        join(ROOT, "infra/route-surface-classification.yaml"),
        "utf8",
      ),
    );
    const row = rows.find((r) => r.path_pattern === "/start");
    expect(row).toMatchObject({
      surface_class: "unauth_marketing",
      prerender: true,
      indexable: false,
    });
  });

  it("its head says noindex; an indexable page's does not", () => {
    const start = getPublicMeta("/start");
    const home = getPublicMeta("/");
    expect(start && home).toBeTruthy(); // presence before absence
    expect(renderPageHead(start!)).toContain(
      '<meta name="robots" content="noindex" />',
    );
    expect(renderPageHead(home!)).not.toContain("noindex");
  });
});
