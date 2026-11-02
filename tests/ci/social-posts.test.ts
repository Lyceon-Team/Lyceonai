/**
 * The shared social copy: TikTok's keywords, the test month, the hashtags and the three QOTD
 * captions (shared/social/posts.ts).
 *
 * @spec [owner brief "Simplify the daily #social messages + add keywords" and Karl's Step 0
 *       rulings (2026-11-02); Karl's answer the same day: the SAT dates are SAT_TEST_DATES]
 *       | @implemented [2026-11-02]
 *
 * plain English: every canonical domain maps to its keywords, in the ruled order and without
 * duplicates; an unknown domain (or another section's) is an error; the test month rolls over the
 * day after a test; with no confirmed SAT left the month is left out and a warning is raised;
 * every caption carries at most five hashtags and no link or promo line except Instagram's one
 * comment-SAT ask.
 */
import { describe, expect, it } from "vitest";
import { CANONICAL_DOMAINS_BY_SECTION } from "../../shared/canonical-domains";
import { SAT_TEST_DATES } from "../../shared/sat-test-dates";
import {
  SAT_DATE_LIST_WARNING,
  SOCIAL_ALWAYS_KEYWORDS,
  SOCIAL_DOMAIN_KEYWORDS,
  nextSatTest,
  qotdFacebookCaption,
  qotdInstagramCaption,
  qotdTiktokCaption,
  socialDateWarnings,
  socialHashtags,
  socialKeywords,
  withoutSocialFixedLines,
  type SocialSection,
} from "../../shared/social/posts";

const SECTIONS: readonly [SocialSection, "M" | "RW"][] = [
  ["Math", "M"],
  ["Reading and Writing", "RW"],
];

/** The brief's table, word for word, keyed on the canonical domain strings. */
const BRIEF_DOMAINS: Record<string, string[]> = {
  Algebra: ["Algebra"],
  "Advanced Math": ["Advanced math", "Algebra 2"],
  "Problem Solving and Data Analysis": ["Data analysis", "Statistics"],
  "Geometry and Trigonometry": ["Geometry", "Trig"],
  "Information and Ideas": ["Reading comprehension"],
  "Craft and Structure": ["Vocabulary"],
  "Expression of Ideas": ["SAT writing"],
  "Standard English Conventions": ["SAT grammar", "Grammar"],
};

describe("TikTok keywords", () => {
  it("the domain map names exactly the eight canonical domains", () => {
    const canonical = [
      ...CANONICAL_DOMAINS_BY_SECTION.M,
      ...CANONICAL_DOMAINS_BY_SECTION.RW,
    ].sort();
    expect(canonical).toHaveLength(8);
    expect(Object.keys(SOCIAL_DOMAIN_KEYWORDS).sort()).toEqual(canonical);
  });

  it.each(
    SECTIONS.flatMap(([section, code]) =>
      CANONICAL_DOMAINS_BY_SECTION[code].map((d) => [section, d] as const),
    ),
  )(
    "%s · %s: test month, always-set, section, domain, in that order",
    (section, domain) => {
      // 2026-10-20: the next SAT is Nov 7.
      const r = socialKeywords("2026-10-20", section, domain);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const sectionKeywords =
        section === "Math" ? ["SAT math"] : ["SAT english", "SAT reading"];
      expect(r.keywords).toEqual([
        "November SAT questions",
        "SAT",
        "SAT prep",
        "Digital SAT",
        "College admissions",
        ...sectionKeywords,
        ...BRIEF_DOMAINS[domain]!,
      ]);
      expect(new Set(r.keywords).size).toBe(r.keywords.length);
    },
  );

  it("no duplicates: a domain keyword equal to an earlier one appears once", () => {
    // "Algebra" is the domain; nothing earlier says it, so it is kept once. A repeated keyword
    // across sets (none in today's wording) would be dropped, not doubled: proven on the set.
    const r = socialKeywords("2026-10-20", "Math", "Algebra");
    if (!r.ok) throw new Error(r.error);
    expect(r.keywords.filter((k) => k === "Algebra")).toHaveLength(1);
    expect(r.keywords.slice(1, 5)).toEqual([...SOCIAL_ALWAYS_KEYWORDS]);
  });

  it("an unknown domain, a non-canonical spelling or another section's domain is an error", () => {
    for (const [section, domain] of [
      ["Math", "Underwater Basket Weaving"],
      ["Math", "Problem-Solving and Data Analysis"],
      ["Math", "Geometry & Trigonometry"],
      ["Math", "Craft and Structure"],
      ["Reading and Writing", "Algebra"],
      ["Math", "constructor"],
      ["Math", "__proto__"],
    ] as const) {
      const r = socialKeywords("2026-10-20", section, domain);
      expect(r, `${section} · ${domain}`).toEqual({
        ok: false,
        error: `keywords: "${domain}" is not a ${section} domain in SOCIAL_DOMAIN_KEYWORDS`,
      });
    }
  });
});

describe("The test month", () => {
  it("is the next confirmed SAT on or after the post date, and rolls over the day after the test", () => {
    expect(nextSatTest("2026-11-06")).toEqual({
      date: "2026-11-07",
      month: "November",
      label: "Nov 7",
    });
    expect(nextSatTest("2026-11-07")?.month).toBe("November");
    expect(nextSatTest("2026-11-08")).toEqual({
      date: "2026-12-05",
      month: "December",
      label: "Dec 5",
    });
    expect(nextSatTest("2026-12-06")?.month).toBe("March");
    const keywords = (date: string): string => {
      const r = socialKeywords(date, "Math", "Algebra");
      if (!r.ok) throw new Error(r.error);
      return r.keywords[0]!;
    };
    expect(keywords("2026-11-07")).toBe("November SAT questions");
    expect(keywords("2026-11-08")).toBe("December SAT questions");
  });

  it("comes from SAT_TEST_DATES (confirmed only): no second list", () => {
    const last = SAT_TEST_DATES.filter((d) => d.status === "confirmed")
      .map((d) => d.date)
      .sort()
      .at(-1)!;
    expect(nextSatTest(last)?.date).toBe(last);
    // The day after the last confirmed date: anticipated dates are never used.
    const after = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(SAT_TEST_DATES.some((d) => d.date > after)).toBe(true); // presence: anticipated ones exist
    expect(nextSatTest(after)).toBeNull();
  });

  it("with no confirmed SAT left: no month anywhere, and a Slack-visible warning", () => {
    const date = "2027-06-06";
    expect(nextSatTest(date)).toBeNull();
    expect(socialDateWarnings(date)).toEqual([
      `${SAT_DATE_LIST_WARNING}: SAT_TEST_DATES has no confirmed SAT on or after ${date}, so the test month is left out`,
    ]);
    expect(socialDateWarnings("2026-11-08")).toEqual([]);
    const r = socialKeywords(date, "Math", "Algebra");
    if (!r.ok) throw new Error(r.error);
    expect(r.keywords[0]).toBe("SAT");
    expect(r.keywords.join(" ")).not.toMatch(/SAT questions/);
    for (const caption of [
      qotdTiktokCaption(date, "Math"),
      qotdInstagramCaption(date, "Math"),
      qotdFacebookCaption(date, "Math"),
    ]) {
      expect(caption.startsWith("SAT question of the day · Math")).toBe(true);
      expect(caption).not.toMatch(
        /January|February|March|April|May|June|July|August|September|October|November|December/,
      );
    }
  });
});

describe("Captions and hashtags (Karl's rulings 2026-11-02)", () => {
  it("hashtags: #SAT #SATprep #digitalSAT #<Month>SAT and the section's, never more than five", () => {
    const test = nextSatTest("2026-11-08");
    expect(socialHashtags(test, "Math")).toBe(
      "#SAT #SATprep #digitalSAT #DecemberSAT #SATMath",
    );
    expect(socialHashtags(test, "Reading and Writing")).toBe(
      "#SAT #SATprep #digitalSAT #DecemberSAT #SATEnglish",
    );
    expect(socialHashtags(null, "Math")).toBe(
      "#SAT #SATprep #digitalSAT #SATMath",
    );
  });

  it.each(SECTIONS.map(([s]) => s))(
    "%s: the TikTok, Instagram and Facebook formats",
    (section) => {
      const date = "2026-11-08";
      const tag = section === "Math" ? "#SATMath" : "#SATEnglish";
      const hashtags = `#SAT #SATprep #digitalSAT #DecemberSAT ${tag}`;
      const headline = `December SAT question of the day · ${section}`;
      expect(qotdTiktokCaption(date, section)).toBe(
        `${headline}\n\nFollow for daily SAT questions 👆 Comment your answer 👇\n\n${hashtags}`,
      );
      expect(qotdInstagramCaption(date, section)).toBe(
        `${headline}\n\nComment your answer 👇\n\nTaking the SAT Dec 5? Comment SAT and I'll send you the link\n\n${hashtags}`,
      );
      expect(qotdFacebookCaption(date, section)).toBe(
        `${headline}\n\nHow would you solve it? Share your approach below 👇\n\n${hashtags}`,
      );
    },
  );

  it("no link, no bio line, no #fyp or #studytok; Facebook asks for no comment word", () => {
    for (const [section] of SECTIONS) {
      for (const date of ["2026-10-20", "2026-11-08", "2027-06-06"]) {
        const tiktok = qotdTiktokCaption(date, section);
        const instagram = qotdInstagramCaption(date, section);
        const facebook = qotdFacebookCaption(date, section);
        for (const c of [tiktok, instagram, facebook]) {
          expect(c.length).toBeGreaterThan(40); // presence before absence
          expect(c).not.toMatch(
            /https?:|lyceon\.ai|link in bio|#fyp|#studytok/i,
          );
          expect(c.match(/#\w+/g)!.length).toBeLessThanOrEqual(5);
          expect(c).not.toMatch(/Free SAT practice/);
        }
        // Instagram's comment-SAT line is the only call to action.
        expect(instagram).toContain("Comment SAT and I'll send you the link");
        expect(tiktok).not.toMatch(/Comment SAT/);
        expect(facebook).not.toMatch(/Comment SAT|Comment your answer/);
      }
    }
  });

  it("the leak checks drop the fixed date line whole, and only whole lines", () => {
    const instagram = qotdInstagramCaption("2026-11-08", "Math");
    expect(instagram).toContain("Taking the SAT Dec 5?"); // presence
    expect(withoutSocialFixedLines(instagram)).not.toContain("Dec 5");
    expect(
      withoutSocialFixedLines(
        "Taking the SAT Dec 5? Comment SAT and I'll send you the link B) 5",
      ),
    ).toContain("B) 5");
  });
});
