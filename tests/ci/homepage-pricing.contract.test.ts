/**
 * The homepage's public offer: one price from Stripe, one CTA, and free-tier
 * claims that agree with themselves.
 *
 * @spec [Doc 02B "Entitlement Matrix" and "Quota Contract"; Doc 09 §1.4, §5.1;
 *        owner ruling 2026-09-03] | @implemented [2026-09-03]
 *
 * plain English: pins the things that are true by absence — no waitlist, no
 * placeholder, no second copy of the free-tier numbers. Expected outcome: the
 * pre-launch card cannot come back, and correcting one copy of a claim without
 * the other goes red.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(filePath: string): string {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

/**
 * The same file with comments removed. Every assertion below that a name has
 * GONE needs this: the file that removed it also explains why it was there, and
 * a scanner that cannot tell prose from code would force that explanation to be
 * deleted to go green — trading the record of a defect for a passing grep.
 */
function readCode(filePath: string): string {
  return read(filePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const HOME = "client/src/pages/home.tsx";
const META = "shared/seo/public-meta.ts";

describe("homepage paid card", () => {
  /**
   * TEST 3 — the CTA goes to signup.
   *
   * `/signup` redirects to `/login` (`App.tsx:71`), which is the same place the
   * free card lands. Asserting the ROUTE rather than the final URL is
   * deliberate: if the redirect is ever removed and `/signup` becomes a real
   * page, this control should follow it there without an edit.
   */
  it('routes "Get Started" to signup', () => {
    const home = readCode(HOME);
    expect(home).toContain('data-testid="button-get-started-paid"');
    expect(home).toMatch(/<Link href="\/signup">[\s\S]{0,400}button-get-started-paid/);
  });

  /**
   * TEST 4 — the pre-launch card is gone, all four pieces of it.
   *
   * Enumerated rather than checked as one, because these shipped together and
   * could be restored one at a time: a "Coming soon" badge over a real price is
   * a worse page than either alone.
   */
  it("keeps no waitlist, badge or placeholder on the page", () => {
    const home = readCode(HOME);
    expect(home).not.toContain("mailto:");
    expect(home).not.toContain("Coming soon");
    expect(home).not.toContain("button-join-waitlist");
    expect(home).not.toContain("TBD");
  });

  /**
   * The price has ONE source. A constant anywhere in this file would be the
   * two-sources-for-one-fact defect on the page that quotes money to strangers,
   * and it is the specific thing `upgrade.tsx`'s `fallbackPlans` does.
   */
  it("carries no hardcoded price and no fallback plan table", () => {
    const home = readCode(HOME);
    expect(home).toContain("getPublicMonthlyPrice");
    expect(home).not.toContain("fallbackPlans");
    expect(home).not.toMatch(/\$\d+\.\d{2}/);
    // `$0` on the free card is the plan's actual name, not a quoted price.
    const amounts = home.match(/amountCents\s*[:=]\s*\d+/g) ?? [];
    expect(amounts).toEqual([]);
  });
});

describe("free-tier claims agree across every public surface", () => {
  /**
   * TEST 5 — the divergence that survived #713.
   *
   * `home.tsx` was corrected and `public-meta.ts` was not, so the FAQ metadata
   * search engines quote kept advertising a premium feature as free. The two
   * copies are compared here rather than each being checked against a literal,
   * because a literal in the test is a THIRD copy of the same fact.
   */
  it("quotes the same daily practice allowance in the page and the FAQ metadata", () => {
    const home = read(HOME);
    const declaration = home.match(
      /const FREE_DAILY_PRACTICE_QUESTIONS = (\d+);/,
    );
    expect(declaration).not.toBeNull();
    const allowance = declaration?.[1] ?? "";
    expect(allowance).not.toBe("");

    const meta = read(META);
    const answer = meta.match(/"What is free vs paid\?",\s*answer:\s*"([^"]+)"/);
    expect(answer).not.toBeNull();
    expect(answer?.[1]).toContain(`${allowance} practice questions per day`);
  });

  /**
   * THE ASSERTION IS AN ABSENCE, AND IT IS THE ONE THAT MATTERS.
   *
   * `server/routes/tutor-runtime.ts:190` denies every non-entitled profile with
   * `entitlement_required` — free gets ZERO tutor messages. The old copy
   * promised five. Any number of free tutor messages is a premium feature
   * advertised as free, so no number is permitted here at all.
   */
  it("promises no free tutor allowance anywhere in the public metadata", () => {
    /*
      `readCode`, not `read`: the corrected file explains in a comment what the
      old claim said ("5 tutor messages"), and a scanner that cannot tell prose
      from code would force that explanation to be deleted to go green.
    */
    const meta = readCode(META);
    expect(meta).not.toMatch(/\d+\s+tutor\s+messages/i);
    expect(meta).not.toMatch(/\d+\s+practice\s+questions and \d+/i);
  });
});
