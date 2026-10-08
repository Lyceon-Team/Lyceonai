// @vitest-environment jsdom
/**
 * UI-58: Help (`/help`), and every Help entry point lands on it (OQ-46).
 *
 * @spec [DESIGN.md §4 Help (seven FAQs, approved copy; "Contact support"; the Policies list; the
 *        footer; the Help rail item opens it), §2 (slim footer on Help); prototype Help.dc.html;
 *        student-UI register OQ-46 (HELP_PATH repointed when the Help page lands), OQ-39 (a)
 *        Trust and Safety → `/legal/trust-and-safety`, (d) `mailto:` the support address; OQ-38
 *        (the ruled guardian sentence)] | @implemented [2026-10-03]
 *
 * plain English: the page renders in the real App shell (footer on) under a memory router. The
 * questions and answers are checked word for word against the prototype's text, written out
 * here rather than imported from the page, so a reworded answer fails. The one deliberate
 * difference, the guardian answer, is the OQ-38 sentence (see help.tsx). The rail's Help item,
 * the avatar menu's Help and the footer's "Help and FAQs" all point at `/help`, and clicking the
 * rail item from Home lands on the Help page.
 *
 * OQ-68 (d), UI-64 (owner ruling, Karl, 2026-10-08: "The '40 questions' copy reads the server
 * quota value (the same source as the 402)"): the first answer's daily number is the quota
 * read's `freeDailyLimit`. The fixture serves 37, not the seeded 40, so a literal cannot pass;
 * the paid shape is the default (Help is shown to paid students, whose `limit` is null).
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { AppShell } from "@/components/layout/app-shell";
import { HELP_PATH } from "@/components/layout/LegalFooter";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { practiceQuotaSchema } from "@lyceon/shared/practice-quota";
import { SUPPORT_EMAIL } from "@/lib/support-contact";
import HelpPage from "./help";

/** A config value that is not the seeded 40 (OQ-68 (d)). */
const FREE_DAILY_LIMIT = 37;

/** `GET /api/practice/quota` as the route writes it for a paid student (practiceQuotaSchema). */
const PAID_QUOTA = practiceQuotaSchema.parse({
  unlimited: true,
  limit: null,
  remaining: null,
  resetAt: null,
  freeDailyLimit: FREE_DAILY_LIMIT,
});
/** The same read for a free student. */
const FREE_QUOTA = practiceQuotaSchema.parse({
  unlimited: false,
  limit: FREE_DAILY_LIMIT,
  remaining: 30,
  resetAt: "2026-10-09T05:00:00.000Z",
  freeDailyLimit: FREE_DAILY_LIMIT,
});

const net = vi.hoisted(() => ({
  log: [] as string[],
  quota: null as unknown,
  quotaStatus: 200,
}));

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    net.log.push(`${init?.method ?? "GET"} ${url}`);
    const isQuota = url.split("?")[0] === "/api/practice/quota";
    return new Response(
      JSON.stringify(
        isQuota ? net.quota : { data: { unread: 0 }, requestId: "r" },
      ),
      {
        status: isQuota ? net.quotaStatus : 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
}));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "00000000-0000-4000-8000-000000000158",
      email: "sam@example.test",
      display_name: "Sam Rivera",
      role: "student",
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isAdmin: false,
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));

/**
 * Help.dc.html's LYC_FAQS, verbatim, except the guardian answer (OQ-38, ruled 2026-10-02) and the
 * first answer's "full-length tests" (the prototype says "full-length practice tests"; owner
 * ruling OQ-62 (b), Karl, 2026-10-05: "'full-length test' wording").
 */
const PROTOTYPE_FAQS: readonly [string, string][] = [
  [
    "What is free, and what needs a paid plan?",
    // The prototype's "40" is the configured daily limit: the served value (OQ-68 (d)).
    `Free: the diagnostic, your projected score, ${FREE_DAILY_LIMIT} practice questions a day and unlimited review. Paid plans add your study calendar, mastery for every domain and skill, full-length tests and LISA, your tutor.`,
  ],
  [
    "How is my projected score worked out?",
    "It comes from your mastery across the eight SAT domains. The range is wide at first and narrows as you answer more questions.",
  ],
  [
    "How does review work?",
    "Every question you miss or skip goes into your review queue. Get it right once and it leaves the queue. Miss it again and it goes to the back of the line.",
  ],
  [
    "Is my Lyceon score an official SAT score?",
    "No. It is a Lyceon-modeled SAT score based on your work here. Your official College Board score may differ.",
  ],
  [
    "What can my guardian see?",
    "A guardian can see your progress: mastery, test scores, your study plan and your projected score. They never see your answers or your conversations with LISA.",
  ],
  [
    "How do I manage or cancel my plan?",
    "Go to Settings, then Billing, and choose Manage billing. If your guardian pays for your plan, they manage it from their own account.",
  ],
  [
    "How do I delete my account?",
    "Go to Settings, then Account, and choose Delete account. We'll email you a link to cancel during the waiting period. After that, your account and progress are permanently deleted.",
  ],
];

function mount(path: string): { history: string[] } {
  const location = memoryLocation({ path, record: true });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: null,
    user: null,
  });
  render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>
        <UpgradeModalProvider autoOpenOnDenial>
          <AppShell panel={null} footer>
            <Switch>
              <Route path="/help" component={HelpPage} />
              <Route>
                <p data-testid="elsewhere">elsewhere</p>
              </Route>
            </Switch>
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { history: location.history ?? [] };
}

beforeEach(() => {
  net.log = [];
  net.quota = PAID_QUOTA;
  net.quotaStatus = 200;
});
afterEach(cleanup);

describe("the Help page (DESIGN.md §4 Help)", () => {
  it("shows the seven questions, word for word, the first one open", async () => {
    mount("/help");
    const faqs = await screen.findAllByTestId("help-faq");
    expect(faqs).toHaveLength(7);
    const questions = faqs.map(
      (f) => within(f).getByRole("button").textContent,
    );
    expect(questions).toEqual(PROTOTYPE_FAQS.map(([q]) => q));
    const first = within(faqs[0] as HTMLElement).getByRole("button");
    expect(first.getAttribute("aria-expanded")).toBe("true");
  });

  it("each answer, opened in turn, is the approved copy, and only one is open at a time", async () => {
    mount("/help");
    const faqs = await screen.findAllByTestId("help-faq");
    // The quota read has answered before the plans answer is compared.
    await within(faqs[0] as HTMLElement).findByText(
      new RegExp(`\\b${FREE_DAILY_LIMIT} practice questions a day\\b`),
    );
    for (const [index, [question, answer]] of PROTOTYPE_FAQS.entries()) {
      const faq = faqs[index] as HTMLElement;
      const button = within(faq).getByRole("button", { name: question });
      if (button.getAttribute("aria-expanded") !== "true") {
        fireEvent.click(button);
      }
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(within(faq).getByText(answer)).toBeTruthy();
      const open = screen
        .getAllByTestId("help-faq")
        .filter(
          (f) =>
            within(f).getByRole("button").getAttribute("aria-expanded") ===
            "true",
        );
      expect(open).toHaveLength(1);
    }
  });

  it("OQ-62 (b): the plans answer says 'full-length tests', never 'full-length practice tests'", async () => {
    mount("/help");
    const faqs = await screen.findAllByTestId("help-faq");
    // Presence first: the plans answer (open by default) names the sittings the ruled way.
    expect(faqs[0]?.textContent).toMatch(/\bfull-length tests and LISA\b/);
    expect(document.body.textContent).not.toMatch(/\bfull-length practice\b/i);
    expect(document.body.textContent).not.toMatch(/\bpractice tests?\b/i);
  });

  it("Contact support writes to the one support address", async () => {
    mount("/help");
    const contact = await screen.findByTestId("help-contact-support");
    expect(contact.textContent).toBe("Contact support");
    expect(contact.getAttribute("href")).toBe(`mailto:${SUPPORT_EMAIL}`);
  });

  it("the Policies list links to the existing legal routes", async () => {
    mount("/help");
    const list = await screen.findByTestId("help-policies");
    expect(
      Array.from(list.querySelectorAll("a")).map((a) => [
        a.textContent,
        a.getAttribute("href"),
      ]),
    ).toEqual([
      ["Privacy Policy", "/legal/privacy-policy"],
      ["Terms of Use", "/legal/student-terms"],
      ["Trust and Safety", "/legal/trust-and-safety"],
    ]);
  });

  it("carries the slim footer and asks the server only for the quota's free daily limit", async () => {
    mount("/help");
    await screen.findByTestId("help-page");
    const footer = screen.getByTestId("legal-footer");
    expect(footer.textContent).toContain("© 2026 Lyceon");
    // Besides the shell's own bell, the one request is the quota read (OQ-68 (d)), once.
    await screen.findByText(/\b37 practice questions a day\b/);
    expect(
      net.log.filter((l) => !l.startsWith("GET /api/notifications")),
    ).toEqual(["GET /api/practice/quota"]);
  });

  it("UI-64: a free reader gets the same served number", async () => {
    net.quota = FREE_QUOTA;
    mount("/help");
    const faqs = await screen.findAllByTestId("help-faq");
    expect(
      await within(faqs[0] as HTMLElement).findByText(
        PROTOTYPE_FAQS[0]?.[1] ?? "",
      ),
    ).toBeTruthy();
  });

  it("UI-64: until the quota read answers, or when it fails, the plans answer prints no number", async () => {
    net.quotaStatus = 500;
    net.quota = { error: "boom" };
    mount("/help");
    const faqs = await screen.findAllByTestId("help-faq");
    await waitFor(() => expect(net.log).toContain("GET /api/practice/quota"));
    expect(faqs[0]?.textContent).toContain(
      "Free: the diagnostic, your projected score, daily practice questions and unlimited review.",
    );
    expect(document.body.textContent).not.toMatch(/\b40\b|forty/i);
  });
});

describe("every Help entry point lands on /help (OQ-46)", () => {
  it("HELP_PATH is the Help page", () => {
    expect(HELP_PATH).toBe("/help");
  });

  it("the rail item, the avatar menu and the footer all lead to /help", async () => {
    const { history } = mount("/dashboard");
    await screen.findByTestId("elsewhere");
    expect(screen.getByTestId("rail-help").getAttribute("href")).toBe("/help");
    const footerHelp = within(screen.getByTestId("legal-footer")).getByText(
      "Help and FAQs",
    );
    expect(footerHelp.getAttribute("href")).toBe("/help");
    // The avatar menu's Help is a menu item that navigates.
    const trigger = screen.getByTestId("button-user-menu");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menuHelp = await screen.findByTestId("menu-help");
    expect(menuHelp.textContent).toBe("Help");
    fireEvent.click(menuHelp);
    expect(await screen.findByTestId("help-page")).toBeTruthy();
    expect(history[history.length - 1]).toBe("/help");
  });

  it("clicking the rail's Help from Home opens the Help page", async () => {
    const { history } = mount("/dashboard");
    await screen.findByTestId("elsewhere");
    fireEvent.click(screen.getByTestId("rail-help"));
    expect(await screen.findByTestId("help-page")).toBeTruthy();
    expect(history[history.length - 1]).toBe("/help");
    expect(screen.getByTestId("rail-help").getAttribute("aria-current")).toBe(
      "page",
    );
  });
});
