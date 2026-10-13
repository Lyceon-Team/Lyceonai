// @vitest-environment jsdom
/**
 * UI-65: the daily-limit billing card is drawn on the student tokens.
 *
 * @spec [student-UI register UI-65; OQ-52 (c), owner ruling (Karl) 2026-10-05: "Restyling
 *        `PremiumUpgradePrompt` onto student tokens is Wave 6 row UI-65"; DESIGN.md §1 (tokens
 *        only, 14px floor, one filled primary per surface, no shadows)] | @implemented [2026-10-08]
 *
 * plain English: renders the card in each student state (unentitled, lapsed) and in its
 * floating mode with the dismiss button, then reads every class on every element. A colour
 * utility must name a student token (`*-lyc-*`); the only exceptions are the canonical Button
 * base's two shadcn ring colours, which `LYC_FOCUS` switches off (`ring-0`, `ring-offset-0`) on
 * every student variant. Nothing may be below 14px, and the card carries no shadow. The action
 * is the outline button, because Practice's filled primary is "Start N questions".
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PremiumUpgradePrompt } from "./PremiumUpgradePrompt";
import type { BillingCtaState } from "@/lib/billing-cta";

vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));
vi.mock("@/lib/billing-client", () => ({ openBillingPortal: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/practice", vi.fn()] }));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ isGuardian: false }),
}));

afterEach(cleanup);

function draw(node: React.ReactNode): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
  return screen.getByTestId("premium-upgrade-prompt");
}

/** A Tailwind colour utility, after any `hover:` / `focus-visible:` style prefixes. */
const COLOUR_UTILITY =
  /^(?:text|bg|border|ring|ring-offset|outline|decoration|fill|stroke|shadow|from|via|to|caret|accent|placeholder|divide)-/;

/**
 * Utilities in those families that set no colour (width, side, offset, style, alignment, size;
 * sizes are judged by BELOW_14 instead).
 */
const NOT_A_COLOUR =
  /^(?:border(?:-[trblxy])?(?:-\d+)?|outline(?:-offset-\d+|-\[\d+px\]|-none)?|ring-\d+|ring-offset-\d+|text-(?:left|center|right|xs|sm|base|lg|\d?xl|\[\d+(?:\.\d+)?px\])|bg-transparent|shadow-none)$/;

/**
 * The canonical Button base's shadcn ring colours. `LYC_FOCUS` (components/ui/button.tsx) sets
 * `focus-visible:ring-0 focus-visible:ring-offset-0` on every student variant, so neither ever
 * paints; they are inherited from the one Button primitive, not written here.
 */
const NEUTRALISED_BY_LYC_FOCUS = new Set([
  "ring-offset-background",
  "focus-visible:ring-ring",
]);

/** Below 14px: the shadcn small sizes and any arbitrary pixel size under 14. */
const BELOW_14 = /^(?:[^\s:]+:)*text-(?:xs|sm|\[(?:\d|1[0-3])(?:\.\d+)?px\])$/;

/** Every class on the card and its descendants that breaks the student-token rules. */
function tokenFindings(card: HTMLElement): {
  classes: string[];
  problems: string[];
} {
  const elements = [card, ...Array.from(card.querySelectorAll("*"))];
  const classes = elements.flatMap((el) =>
    (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
  );
  const problems: string[] = [];
  for (const cls of classes) {
    const bare = cls.split(":").pop() ?? cls;
    if (BELOW_14.test(cls)) problems.push(`below 14px: ${cls}`);
    if (/^shadow(?:-|$)/.test(bare) && bare !== "shadow-none")
      problems.push(`shadow: ${cls}`);
    if (!COLOUR_UTILITY.test(bare)) continue;
    if (bare.includes("lyc-")) continue;
    if (NOT_A_COLOUR.test(bare)) continue;
    if (NEUTRALISED_BY_LYC_FOCUS.has(cls)) continue;
    problems.push(`not a student token: ${cls}`);
  }
  for (const el of elements) {
    const style = el.getAttribute("style") ?? "";
    if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(style))
      problems.push(`raw colour in style: ${style}`);
  }
  return { classes, problems };
}

const STUDENT_STATES: readonly BillingCtaState[] = [
  { kind: "student_unentitled" },
  { kind: "student_lapsed" },
];

describe("UI-65: PremiumUpgradePrompt is on the student tokens", () => {
  for (const state of STUDENT_STATES) {
    it(`${state.kind}: every colour is a student token, nothing below 14px, no shadow`, () => {
      const card = draw(
        <PremiumUpgradePrompt
          state={state}
          featureBenefit="unlimited daily practice"
        />,
      );
      const { classes, problems } = tokenFindings(card);
      // Presence before absence: the card is drawn and carries the student card's own tokens.
      expect(card.getAttribute("data-cta-state")).toBe(state.kind);
      expect(classes).toEqual(
        expect.arrayContaining([
          "bg-lyc-sheet",
          "border-lyc-rule",
          "text-lyc-ink-strong",
          "text-lyc-body",
        ]),
      );
      expect(classes.length).toBeGreaterThan(20);
      expect(problems).toEqual([]);
    });
  }

  it("floating, with the dismiss button: the same rules", () => {
    const card = draw(
      <PremiumUpgradePrompt
        state={{ kind: "student_unentitled" }}
        mode="floating"
        onDismiss={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Dismiss upgrade prompt" }),
    ).toBeTruthy();
    expect(card.className).toContain("fixed");
    expect(tokenFindings(card).problems).toEqual([]);
  });

  it("is a labelled region whose heading is the copy's title, and its action is the outline button", () => {
    const card = draw(
      <PremiumUpgradePrompt state={{ kind: "student_unentitled" }} />,
    );
    const heading = screen.getByRole("heading", { level: 3 });
    expect(card.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.textContent).toBe("Subscription required");
    const cta = screen.getByTestId("premium-upgrade-cta");
    expect(cta.className).toContain("border-lyc-ink-strong");
    expect(cta.className).not.toContain("bg-lyc-primary-bg");
  });
});
