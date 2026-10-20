// @vitest-environment jsdom
/**
 * The homepage Trustpilot card, the footer's Feedback links and the /contact page.
 *
 * @spec [final brief "Trustpilot card on the homepage + 'Feedback' across the site" (Karl,
 *       2026-10-20) §1 (between the FAQ and the final call to action; static, text-only, no
 *       third-party request; the approved copy; hidden without VITE_TRUSTPILOT_REVIEW_URL), §2
 *       (footer Feedback → /contact and Review us on Trustpilot; /contact with the email, the
 *       postal address and the signed-in line, and no form), acceptance "Tests"]
 *       | @implemented [2026-10-20]
 *
 * plain English: the real page as a logged-out visitor sees it, with the same doubles as the
 * pricing test (home.pricing.test.tsx). Presence is proved before absence: with the URL set the
 * card and the footer link are there, in order; without it neither is.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./home";
import ContactPage from "./contact";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    isAuthenticated: false,
    isGuardian: false,
    signOut: vi.fn(),
  }),
}));

// THE DOUBLE RENDERS AN ANCHOR, because the real `Link` does.
//
// This used to be `({ children }) => <>{children}</>` — every prop discarded. That was
// faithful ONLY while the app used the wouter v2 idiom and put `href` and `data-testid`
// on a nested `<a>` CHILD, which the fragment passed through by accident. Once #829 moved
// those props onto `<Link>` itself, the double swallowed them and two tests failed for a
// defect the app does not have: the testid was present in every browser and absent only
// here. A fake that does not model the thing it stands for reports on itself.
vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ["/", vi.fn()],
}));

const fetchMock = vi.fn();

function withClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const REVIEW_URL = "https://www.trustpilot.com/evaluate/lyceon.ai";

describe("the homepage Trustpilot card", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: {} }),
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("with the review URL: the approved copy, between the FAQ and the final call to action", () => {
    vi.stubEnv("VITE_TRUSTPILOT_REVIEW_URL", REVIEW_URL);
    const { container } = withClient(<HomePage />);
    const card = screen.getByTestId("trustpilot-card");
    expect(card.querySelector("h2")?.textContent).toBe(
      "Used Lyceon? Tell others how it went.",
    );
    expect(card.textContent).toContain(
      "Parents and students 18+ can share their experience on Trustpilot.",
    );
    const review = screen.getByTestId("trustpilot-card-review");
    expect(review.textContent).toBe("Review us on Trustpilot ↗");
    expect(review.getAttribute("href")).toBe(REVIEW_URL);
    expect(review.getAttribute("target")).toBe("_blank");
    expect(review.getAttribute("rel")).toContain("noopener");
    const profile = screen.getByTestId("trustpilot-card-profile");
    expect(profile.textContent).toBe("See reviews");
    expect(profile.getAttribute("href")).toBe(
      "https://www.trustpilot.com/review/lyceon.ai",
    );
    // Order: FAQ, then the card, then "Study Smarter, Score Higher." last.
    const html = container.innerHTML;
    const faq = html.indexOf('id="faq"');
    const at = html.indexOf('data-testid="trustpilot-card"');
    const cta = html.indexOf('aria-label="Get started"');
    expect(faq).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(faq);
    expect(cta).toBeGreaterThan(at);
  });

  it("is text only and asks nothing of Trustpilot: no script, frame or image, no request", () => {
    vi.stubEnv("VITE_TRUSTPILOT_REVIEW_URL", REVIEW_URL);
    const { container } = withClient(<HomePage />);
    const card = screen.getByTestId("trustpilot-card");
    expect(
      card.querySelectorAll("script, iframe, img, svg, object"),
    ).toHaveLength(0);
    expect(card.textContent).not.toMatch(
      /★|TrustScore|\d(\.\d)? ?(out of|\/) ?5/,
    );
    expect(
      container.querySelectorAll(
        'script[src*="trustpilot"], iframe[src*="trustpilot"], img[src*="trustpilot"]',
      ),
    ).toHaveLength(0);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("trustpilot");
    }
  });

  it("without the review URL: no card and no footer Trustpilot link; Feedback stays", () => {
    vi.stubEnv("VITE_TRUSTPILOT_REVIEW_URL", "");
    withClient(<HomePage />);
    expect(screen.getByTestId("footer-feedback")).toBeTruthy(); // presence first
    expect(screen.queryByTestId("trustpilot-card")).toBeNull();
    expect(screen.queryByTestId("home-trustpilot")).toBeNull();
    expect(screen.queryByTestId("footer-trustpilot")).toBeNull();
  });

  it("the footer: Feedback goes to /contact; Review us on Trustpilot to the review form, in a new tab", () => {
    vi.stubEnv("VITE_TRUSTPILOT_REVIEW_URL", REVIEW_URL);
    withClient(<HomePage />);
    const feedback = screen.getByTestId("footer-feedback");
    expect(feedback.textContent).toBe("Feedback");
    expect(feedback.getAttribute("href")).toBe("/contact");
    const tp = screen.getByTestId("footer-trustpilot");
    expect(tp.textContent).toBe("Review us on Trustpilot ↗");
    expect(tp.getAttribute("href")).toBe(REVIEW_URL);
    expect(tp.getAttribute("target")).toBe("_blank");
    expect(tp.getAttribute("rel")).toContain("noopener");
  });
});

describe("/contact", () => {
  it("shows the support email, the postal address and the signed-in line, with no form", () => {
    const { container } = withClient(<ContactPage />);
    const page = screen.getByTestId("contact-page");
    expect(screen.getByTestId("contact-email").textContent).toBe(
      "support@lyceon.ai",
    );
    expect(screen.getByTestId("contact-address").textContent).toBe(
      "Lyceon AI, 5650 Central Ave # E7, Toledo, OH 43615",
    );
    expect(screen.getByTestId("contact-signed-in").textContent).toBe(
      "Signed in? Use Send feedback in your account menu.",
    );
    expect(
      page.querySelectorAll("form, input, textarea, select, button"),
    ).toHaveLength(0);
    // The public footer is on it too, with its Feedback link back here.
    expect(
      container.querySelector('[data-testid="footer-feedback"]'),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
