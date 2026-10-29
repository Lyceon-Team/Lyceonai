// @vitest-environment jsdom
/**
 * The sign-up channel in the browser: read from the landing address, carried on the link into
 * sign-up, first touch wins.
 *
 * @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
 *       2026-10-28) item 2] | @implemented [2026-10-28]
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  captureSignupAttribution,
  resetSignupAttributionForTests,
  signupAttribution,
  withSignupAttribution,
} from "./signup-attribution";

function landOn(path: string): void {
  window.history.replaceState(null, "", path);
  resetSignupAttributionForTests();
  captureSignupAttribution();
}

function click(href: string): string {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  a.addEventListener("click", (e) => e.preventDefault());
  document.body.appendChild(a);
  a.click();
  const result = a.getAttribute("href") ?? "";
  a.remove();
  return result;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  resetSignupAttributionForTests();
});

describe("the sign-up channel in the browser", () => {
  it("C1 the landing address's UTM is the attribution, with no storage written", () => {
    landOn("/?utm_source=Reddit&utm_medium=social&utm_campaign=QOTD&gclid=x");
    expect(signupAttribution()).toEqual({
      channel: "reddit",
      campaign: "qotd",
    });
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("C2 a click into sign-up carries it; other links are left alone", () => {
    landOn("/?utm_source=tiktok&utm_campaign=dec_cohort");
    expect(click("/login")).toBe(
      "http://localhost:3000/login?signup_channel=tiktok&signup_campaign=dec_cohort",
    );
    expect(click("/login?mode=signup")).toBe(
      "http://localhost:3000/login?mode=signup&signup_channel=tiktok&signup_campaign=dec_cohort",
    );
    expect(click("/blog/what-is-a-good-sat-score")).toBe(
      "/blog/what-is-a-good-sat-score",
    );
    expect(click("https://example.com/login")).toBe(
      "https://example.com/login",
    );
  });

  it("C3 the sign-up page reads the carried touch, which wins over its own UTM", () => {
    landOn(
      "/login?signup_channel=tiktok&signup_campaign=dec_cohort&utm_source=reddit",
    );
    expect(signupAttribution()).toEqual({
      channel: "tiktok",
      campaign: "dec_cohort",
    });
  });

  it("C4 a plain visit is direct and carries nothing", () => {
    landOn("/");
    expect(signupAttribution()).toEqual({ channel: "direct", campaign: null });
    expect(click("/login")).toBe("/login");
  });

  it("C5 a link that already carries a touch keeps it", () => {
    landOn("/?utm_source=reddit");
    expect(
      withSignupAttribution(
        "/login?signup_channel=email",
        "http://localhost:3000",
        signupAttribution(),
      ),
    ).toBe("http://localhost:3000/login?signup_channel=email");
  });
});
