// @vitest-environment jsdom
/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md F13; owner rulings 2026-10-05, Step 0 decisions
 *       5 and 6 (variant from the next homepage view, inline script, `ph_` storage, exposure only
 *       when displayed)] | @implemented [2026-10-05]
 *
 * plain English: the inline swap script and `storedHeroVariant` must agree on every consent and
 * storage state, or the page would paint one hero and React would draw another — the flicker
 * the design exists to prevent. This runs the real script text over the same inputs the module
 * reads, as theme.boot.test.ts does for the theme script.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COOKIE_BANNER_VERSION,
  CONSENT_MAX_AGE_SECONDS,
} from "@lyceon/shared/analytics-consent-schema";
import {
  HERO_COPY,
  HERO_SUB_ID,
  HERO_SWAP_SCRIPT,
  HERO_TITLE_ID,
  HERO_VARIANT_STORAGE_KEY,
  storeHeroVariant,
  storedHeroVariant,
} from "./hero-experiment";

const ID = "0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";
const now = (): number => Math.floor(Date.now() / 1000);

function clearCookies(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

/** The prerendered hero: Variant A's text in the two elements the script swaps. */
function mountHero(): void {
  document.body.innerHTML = `<h1 id="${HERO_TITLE_ID}">${HERO_COPY.control.title}</h1><p id="${HERO_SUB_ID}">${HERO_COPY.control.sub}</p>`;
}

function runScript(): "control" | "test" {
  new Function(HERO_SWAP_SCRIPT)();
  const title = document.getElementById(HERO_TITLE_ID)?.textContent;
  const sub = document.getElementById(HERO_SUB_ID)?.textContent;
  if (title === HERO_COPY.test.title && sub === HERO_COPY.test.sub)
    return "test";
  expect(title).toBe(HERO_COPY.control.title);
  expect(sub).toBe(HERO_COPY.control.sub);
  return "control";
}

beforeEach(() => {
  clearCookies();
  window.localStorage.clear();
  mountHero();
});

afterEach(() => {
  clearCookies();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

type Case = [label: string, cookie: string | null, stored: string | null];

const CASES: Case[] = [
  ["no consent, nothing stored", null, null],
  ["no consent, B stored", null, "test"],
  ["accepted, B stored", `${COOKIE_BANNER_VERSION}.${ID}.a.${now()}`, "test"],
  [
    "accepted, A stored",
    `${COOKIE_BANNER_VERSION}.${ID}.a.${now()}`,
    "control",
  ],
  [
    "accepted, nothing stored",
    `${COOKIE_BANNER_VERSION}.${ID}.a.${now()}`,
    null,
  ],
  ["accepted, junk stored", `${COOKIE_BANNER_VERSION}.${ID}.a.${now()}`, "B"],
  ["refused, B stored", `${COOKIE_BANNER_VERSION}.${ID}.r.${now()}`, "test"],
  [
    "older banner version, B stored",
    `${COOKIE_BANNER_VERSION - 1}.${ID}.a.${now()}`,
    "test",
  ],
  [
    "consent older than 6 months, B stored",
    `${COOKIE_BANNER_VERSION}.${ID}.a.${now() - CONSENT_MAX_AGE_SECONDS - 60}`,
    "test",
  ],
  [
    "consent dated in the future (a wrong clock), B stored",
    `${COOKIE_BANNER_VERSION}.${ID}.a.${now() + 3600}`,
    "test",
  ],
  [
    "consent exactly 6 months old, B stored",
    `${COOKIE_BANNER_VERSION}.${ID}.a.${now() - CONSENT_MAX_AGE_SECONDS}`,
    "test",
  ],
  [
    "malformed consent id, B stored",
    `${COOKIE_BANNER_VERSION}.not-a-uuid-not-a-uuid-not-a-uuid-xx.a.${now()}`,
    "test",
  ],
];

describe("homepage-hero swap script agrees with storedHeroVariant", () => {
  it("the script carries Variant B's approved copy and the storage key (presence first)", () => {
    expect(HERO_SWAP_SCRIPT).toContain(JSON.stringify(HERO_COPY.test.title));
    expect(HERO_SWAP_SCRIPT).toContain(JSON.stringify(HERO_COPY.test.sub));
    expect(HERO_SWAP_SCRIPT).toContain(
      JSON.stringify(HERO_VARIANT_STORAGE_KEY),
    );
  });

  it.each(CASES)("%s", (_label, cookie, stored) => {
    if (cookie !== null) document.cookie = `lyceon_consent=${cookie}; Path=/`;
    if (stored !== null)
      window.localStorage.setItem(HERO_VARIANT_STORAGE_KEY, stored);
    const module = storedHeroVariant(
      document.cookie,
      window.localStorage,
      now(),
    );
    const painted = runScript();
    expect(painted).toBe(module === "test" ? "test" : "control");
  });

  it("B is painted only with valid consent AND B stored (the one positive case is real)", () => {
    document.cookie = `lyceon_consent=${COOKIE_BANNER_VERSION}.${ID}.a.${now()}; Path=/`;
    window.localStorage.setItem(HERO_VARIANT_STORAGE_KEY, "test");
    expect(runScript()).toBe("test");
  });

  it("storage is ph_-prefixed, so withdrawal's PostHog storage clean-up deletes it", () => {
    expect(HERO_VARIANT_STORAGE_KEY).toMatch(/^ph_/);
    expect(storeHeroVariant("test")).toBe(true);
    expect(window.localStorage.getItem(HERO_VARIANT_STORAGE_KEY)).toBe("test");
  });
});
