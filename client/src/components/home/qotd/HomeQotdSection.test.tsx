// @vitest-environment jsdom
/**
 * Home's Question of the Day: the card's states, the streak chip, the email prompt's copy, focus
 * and keyboard, and the SAT-date card.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09) "Home, top to bottom"
 *       2-4, "Email prompt rule", acceptance 2 and 10] | @implemented [2026-10-09]
 *
 * plain English: the section mounted with the real hooks over a fake network. Every payload is
 * parsed with the shared response schema before it is served, so the fixtures are shapes the
 * server can emit (the server itself is proved in tests/ci/home-qotd.pg.ci.test.ts).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  homeQotdAnswerResponseSchema,
  homeQotdTodayResponseSchema,
  streakChipText,
  QOTD_EMAIL_PROMPT_COPY,
  type HomeQotdTodayResponse,
} from "@lyceon/shared/home-qotd-schema";
import { HomeQotdSection } from "./HomeQotdSection";
import { HomeStreakChip } from "./StreakChip";
import { GoalCard } from "@/features/calendar/components/StudentChrome";

const net = vi.hoisted(() => ({
  log: [] as { method: string; url: string; body: unknown }[],
  today: null as unknown,
  answer: null as unknown,
  profile: { profile: null } as unknown,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as unknown)
        : null;
    net.log.push({ method, url, body });
    if (url === "/api/qotd/today") return json({ data: net.today });
    if (url === "/api/qotd/answer") return json({ data: net.answer }, 201);
    if (url === "/api/qotd/email-consent")
      return json({ data: { consented: true, show_email_prompt: false } });
    if (url.startsWith("/api/calendar/profile"))
      return json({ ...(net.profile as object), requestId: "r" });
    return json({ error: "Not found" }, 404);
  },
}));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "s1",
      email: "s@example.test",
      display_name: "Sam",
      role: "student",
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
  }),
}));

const STEM = "If 3x + 2 = 11, what is the value of x?";
const EXPLANATION = "Subtract 2, then divide by 3: x = 3.";
const TOKENS = [
  "tokAAAAAAAAAAAAAAAAAAA",
  "tokBBBBBBBBBBBBBBBBBBB",
  "tokCCCCCCCCCCCCCCCCCCC",
  "tokDDDDDDDDDDDDDDDDDDD",
];
const QUESTION = {
  section_code: "M" as const,
  domain: "Algebra",
  item_type: "mcq" as const,
  stem: STEM,
  passage: null,
  options: TOKENS.map((id, i) => ({ id, text: ["2", "3", "4", "5"][i] ?? "" })),
  correct_answer: null,
  explanation: null,
};
const RESULT = {
  is_correct: false,
  selected_option_id: TOKENS[0],
  correct_option_id: TOKENS[1],
  correct_display_letter: "B",
  correct_answer: null,
  explanation: EXPLANATION,
};

function unanswered(): HomeQotdTodayResponse {
  return homeQotdTodayResponseSchema.parse({
    state: "unanswered",
    qotd_date: "2026-10-09",
    question: QUESTION,
    streak: { current: 0, today_done: false, broken: false },
    show_email_prompt: false,
    show_dont_ask_again: false,
  });
}

function answeredEarlier(): HomeQotdTodayResponse {
  return homeQotdTodayResponseSchema.parse({
    state: "answered",
    qotd_date: "2026-10-09",
    question: QUESTION,
    result: RESULT,
    streak: { current: 4, today_done: true, broken: false },
    show_email_prompt: true,
    show_dont_ask_again: false,
  });
}

function answer(over: { ask3?: boolean; prompt?: boolean } = {}): unknown {
  return homeQotdAnswerResponseSchema.parse({
    qotd_date: "2026-10-09",
    result: RESULT,
    streak: { current: 1, today_done: true, broken: false },
    streak_extended: true,
    show_email_prompt: over.prompt ?? true,
    show_dont_ask_again: over.ask3 ?? false,
  });
}

function mount(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let celebrate = false;
  render(
    <QueryClientProvider client={client}>
      <HomeStreakChip celebrate={celebrate} />
      <HomeQotdSection
        onStreakExtended={() => {
          celebrate = true;
        }}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  net.log = [];
  net.profile = { profile: null };
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("the streak chip's words", () => {
  it("at 0, done today, not yet today, and after a break", () => {
    expect(
      streakChipText({ current: 0, today_done: false, broken: false }),
    ).toBe("Start your streak");
    expect(
      streakChipText({ current: 3, today_done: true, broken: false }),
    ).toBe("🔥 3 · Today ✓");
    expect(
      streakChipText({ current: 3, today_done: false, broken: false }),
    ).toBe("🔥 3 · keep it going today");
    expect(
      streakChipText({ current: 0, today_done: false, broken: true }),
    ).toBe("Start a new streak today");
  });
});

describe("Home QOTD card", () => {
  it("unanswered: the stem, choices lettered A-D by position, Submit — and no answer or explanation", async () => {
    net.today = unanswered();
    mount();
    expect(await screen.findByText(STEM)).toBeTruthy();
    expect(screen.getByTestId("home-qotd").getAttribute("data-state")).toBe(
      "unanswered",
    );
    expect(screen.getByTestId("home-qotd").id).toBe("qotd");
    // Presence before absence: four choices are drawn.
    for (const text of ["2", "3", "4", "5"])
      expect(screen.getByText(text)).toBeTruthy();
    expect(document.body.textContent).not.toContain(EXPLANATION);
    const submit = screen.getByTestId("home-qotd-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId("home-streak-chip").textContent).toBe(
      "Start your streak",
    );
  });

  it("answering: one POST with the token and a key; the result, the chip, then the prompt with the exact copy and focus on Yes", async () => {
    net.today = unanswered();
    net.answer = answer();
    mount();
    fireEvent.click(await screen.findByText("2"));
    fireEvent.click(screen.getByTestId("home-qotd-submit"));
    expect(await screen.findByText(EXPLANATION)).toBeTruthy();
    const posts = net.log.filter((c) => c.url === "/api/qotd/answer");
    expect(posts).toHaveLength(1);
    const body = posts[0]?.body as Record<string, unknown>;
    expect(body.option_token).toBe(TOKENS[0]);
    expect(body.qotd_date).toBe("2026-10-09");
    expect(String(body.idempotency_key)).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() =>
      expect(screen.getByTestId("home-streak-chip").textContent).toBe(
        "🔥 1 · Today ✓",
      ),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(QOTD_EMAIL_PROMPT_COPY.title);
    expect(dialog.textContent).toContain(QOTD_EMAIL_PROMPT_COPY.body);
    expect(screen.getByTestId("qotd-email-yes").textContent).toBe("Yes");
    expect(screen.getByTestId("qotd-email-not-now").textContent).toBe(
      "Not now",
    );
    // The first ask has no "Don't ask again".
    expect(screen.queryByTestId("qotd-email-never")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("qotd-email-yes")),
    );
  });

  it("Escape closes the prompt and counts as 'Not now'", async () => {
    net.today = unanswered();
    net.answer = answer();
    mount();
    fireEvent.click(await screen.findByText("3"));
    fireEvent.click(screen.getByTestId("home-qotd-submit"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const decisions = net.log.filter(
      (c) => c.url === "/api/qotd/email-consent",
    );
    expect(
      decisions.map((c) => (c.body as { decision: string }).decision),
    ).toEqual(["not_now"]);
  });

  it("from the 3rd ask the prompt offers 'Don't ask again'; Yes sends a grant with the consent version", async () => {
    net.today = unanswered();
    net.answer = answer({ ask3: true });
    mount();
    fireEvent.click(await screen.findByText("4"));
    fireEvent.click(screen.getByTestId("home-qotd-submit"));
    expect((await screen.findByTestId("qotd-email-never")).textContent).toBe(
      "Don't ask again",
    );
    fireEvent.click(screen.getByTestId("qotd-email-yes"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const grant = net.log.find((c) => c.url === "/api/qotd/email-consent");
    expect(grant?.body).toEqual({
      decision: "grant",
      consent_version: "1.0.0",
    });
  });

  it("no prompt when the server says not to (under-13, already said yes)", async () => {
    net.today = unanswered();
    net.answer = answer({ prompt: false });
    mount();
    fireEvent.click(await screen.findByText("2"));
    fireEvent.click(screen.getByTestId("home-qotd-submit"));
    expect(await screen.findByText(EXPLANATION)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("answered on an earlier visit: collapsed, with See explanation, and no prompt", async () => {
    net.today = answeredEarlier();
    mount();
    const collapsed = await screen.findByTestId("home-qotd-collapsed");
    expect(collapsed.textContent).toBe(
      "✓ Today's question done · 🔥 4-day streak · New question tomorrow",
    );
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("home-qotd-see-explanation"));
    expect(await screen.findByText(EXPLANATION)).toBeTruthy();
  });

  // QOTD resilience brief (Karl, 2026-10-09) §1: collapsed "on its way", the chip unchanged.
  it("no question today: the card collapses to 'on its way', and the chip still shows the streak", async () => {
    net.today = homeQotdTodayResponseSchema.parse({
      state: "none",
      streak: { current: 2, today_done: false, broken: false },
      show_email_prompt: false,
      show_dont_ask_again: false,
    });
    mount();
    expect((await screen.findByTestId("home-streak-chip")).textContent).toBe(
      "🔥 2 · keep it going today",
    );
    const card = await screen.findByTestId("home-qotd");
    expect(card.getAttribute("data-state")).toBe("none");
    expect(screen.getByTestId("home-qotd-none").textContent).toBe(
      "Today's question is on its way. Check back soon.",
    );
    // Collapsed: no question, no choices, no Submit.
    expect(screen.queryByTestId("home-qotd-submit")).toBeNull();
    expect(screen.queryAllByTestId("runner-choice")).toHaveLength(0);
  });
});

describe("the SAT-date card", () => {
  it("shows while no date is saved, and saves a dates-only body through PUT /api/calendar/profile", async () => {
    net.today = answeredEarlier();
    mount();
    fireEvent.click(await screen.findByTestId("home-sat-date-open"));
    const options = screen.getAllByRole("checkbox");
    // "Not sure yet" first, then future official dates only.
    expect(options.length).toBeGreaterThan(2);
    fireEvent.click(options[1] as HTMLElement);
    fireEvent.click(screen.getByTestId("home-sat-date-save"));
    await waitFor(() =>
      expect(
        net.log.filter(
          (c) => c.method === "PUT" && c.url === "/api/calendar/profile",
        ),
      ).toHaveLength(1),
    );
    const put = net.log.find((c) => c.method === "PUT");
    const body = put?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "idempotency_key",
      "target_exam_dates",
    ]);
    expect((body.target_exam_dates as string[]).length).toBe(1);
  });

  it("is absent once a future date is saved", async () => {
    net.today = answeredEarlier();
    net.profile = {
      profile: {
        timezone: "America/Chicago",
        target_exam_date: "2099-06-05",
        target_exam_dates: ["2099-06-05"],
        target_score: null,
        study_days_mask: null,
        daily_minutes: null,
        full_length_weekday: null,
        full_length_interval_weeks: null,
        planner_mode: "auto",
        setup_completed_at: null,
      },
    };
    mount();
    await screen.findByTestId("home-qotd-collapsed");
    await waitFor(() =>
      expect(
        net.log.some((c) => c.url.startsWith("/api/calendar/profile")),
      ).toBe(true),
    );
    expect(screen.queryByTestId("home-sat-date-card")).toBeNull();
  });
});

describe("the calendar goal card's streak (paid)", () => {
  it("shows '🔥 N-day streak' from 1 day, and nothing at 0", () => {
    const { rerender } = render(
      <GoalCard
        today="2026-10-09"
        testDate={null}
        targetScore={null}
        projection={[]}
        streakDays={6}
      />,
    );
    expect(screen.getByTestId("calendar-goal-streak").textContent).toBe(
      "🔥 6-day streak",
    );
    rerender(
      <GoalCard
        today="2026-10-09"
        testDate={null}
        targetScore={null}
        projection={[]}
        streakDays={0}
      />,
    );
    expect(screen.queryByTestId("calendar-goal-streak")).toBeNull();
  });
});
