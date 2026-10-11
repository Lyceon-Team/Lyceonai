/**
 * @spec [owner brief (Karl) 2026-10-10: "/upgrade?promo=<CODE>: not signed in, visitors go
 *        through sign-in and come back to the same /upgrade?promo=… link"; AS-5 allowlisted
 *        `next`] | @implemented [2026-10-10]
 *
 * plain English: the promo link's whole round trip through the ONE return-path module, on the
 * real functions: the guard's login redirect carries it, the login page reads it back, and the
 * post-auth decision lands a student on it (directly, or after onboarding). The Google callback
 * uses the same `sanitizeReturnPath` (`server/routes/oauth-callback-routes.ts` `parseSafeNext`).
 */
import { describe, expect, it } from "vitest";
import {
  loginPathWithReturn,
  onboardingPathWithReturn,
  postAuthDestination,
  returnPathFromSearch,
  sanitizeReturnPath,
} from "../return-path";

const LINK = "/upgrade?promo=FOUNDING50";

describe("/upgrade?promo= survives sign-in", () => {
  it("the login redirect carries the link, and the login page reads back the same link", () => {
    const login = loginPathWithReturn(LINK);
    expect(login).toBe("/login?next=%2Fupgrade%3Fpromo%3DFOUNDING50");
    const search = login.slice(login.indexOf("?"));
    expect(returnPathFromSearch(search)).toBe(LINK);
    expect(sanitizeReturnPath(LINK)).toBe(LINK);
  });

  it("a signed-in student lands on the same link, query intact", () => {
    expect(
      postAuthDestination({
        role: "student",
        needsOnboarding: false,
        next: LINK,
      }),
    ).toBe(LINK);
  });

  it("a brand-new student goes through onboarding and the link rides along", () => {
    const onboarding = postAuthDestination({
      role: "student",
      needsOnboarding: true,
      next: LINK,
    });
    expect(onboarding).toBe(onboardingPathWithReturn(LINK));
    const search = onboarding.slice(onboarding.indexOf("?"));
    expect(returnPathFromSearch(search)).toBe(LINK);
  });
});
