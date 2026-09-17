// @vitest-environment jsdom
/**
 * @spec [Doc-01_V8 §36.2; owner brief 2026-09-15 Part B2 ("an email field on the same panel
 *        as the link code, with the code still shown")] | @implemented [2026-09-15]
 *
 * plain English: the invite form is an ADDITION to the code panel. Proves the code stays on
 * screen beside the form, the submit is disabled until the address parses, a submit POSTs the
 * normalised address to the invite URL and nothing else, success reports "sent" without
 * claiming anything about the address, and a 429 is shown as the server's message.
 *
 * MOCK BOUNDARY. `csrfFetch` is replaced; nothing else is.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const csrfFetchMock = vi.fn();
vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...a: unknown[]) => csrfFetchMock(...a),
}));

import { StudentLinkCodePanel } from "./StudentLinkCodePanel";
import { studentLinkCodeInviteUrl } from "../../../../packages/shared/src/student-resources";

const STUDENT = "22222222-2222-4222-8222-222222222222";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const codeView = {
  data: {
    code: "ABC234",
    expiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
  },
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudentLinkCodePanel studentId={STUDENT} />
    </QueryClientProvider>,
  );
}

function postCalls(): unknown[][] {
  return csrfFetchMock.mock.calls.filter(
    (c) => (c[1] as { method?: string } | undefined)?.method === "POST",
  );
}

describe("student link code panel — invite by email", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the invite form BESIDE the code (the verbal path is not replaced)", async () => {
    csrfFetchMock.mockResolvedValue(jsonResponse(codeView));
    renderPanel();
    expect(
      await screen.findByTestId("student-link-code-value"),
    ).toHaveTextContent("ABC234");
    expect(screen.getByTestId("student-link-invite-form")).toBeTruthy();
    expect(screen.getByTestId("student-link-invite-email")).toBeTruthy();
  });

  it("submit stays disabled until the address parses", async () => {
    csrfFetchMock.mockResolvedValue(jsonResponse(codeView));
    renderPanel();
    await screen.findByTestId("student-link-code-value");
    const submit = screen.getByTestId(
      "student-link-invite-submit",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("student-link-invite-email"), {
      target: { value: "not-an-email" },
    });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("student-link-invite-email"), {
      target: { value: " Parent@Example.test " },
    });
    expect(submit.disabled).toBe(false);
  });

  it("POSTs the normalised address to the invite URL and reports 'sent' without naming the address's status", async () => {
    csrfFetchMock.mockImplementation(
      async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return jsonResponse(
            { data: { accepted: true, expiresAt: codeView.data.expiresAt } },
            202,
          );
        }
        return jsonResponse(codeView);
      },
    );
    renderPanel();
    await screen.findByTestId("student-link-code-value");
    fireEvent.change(screen.getByTestId("student-link-invite-email"), {
      target: { value: " Parent@Example.test " },
    });
    fireEvent.submit(screen.getByTestId("student-link-invite-form"));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [url, init] = postCalls()[0] as [string, RequestInit];
    expect(url).toBe(studentLinkCodeInviteUrl(STUDENT));
    expect(JSON.parse(String(init.body))).toEqual({
      email: "parent@example.test",
    });
    const sent = await screen.findByTestId("student-link-invite-sent");
    expect(sent.textContent).toMatch(/invite sent/i);
    expect(sent.textContent?.toLowerCase()).not.toMatch(
      /account|exists|registered/,
    );
    // The code is still there afterwards.
    expect(screen.getByTestId("student-link-code-value")).toHaveTextContent(
      "ABC234",
    );
  });

  it("a 429 from the rate limit is shown, not swallowed", async () => {
    csrfFetchMock.mockImplementation(
      async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return jsonResponse(
            {
              error: "Rate limit exceeded for guardian_link_email_attempts",
              code: "RATE_LIMITED",
            },
            429,
          );
        }
        return jsonResponse(codeView);
      },
    );
    renderPanel();
    await screen.findByTestId("student-link-code-value");
    fireEvent.change(screen.getByTestId("student-link-invite-email"), {
      target: { value: "parent@example.test" },
    });
    fireEvent.submit(screen.getByTestId("student-link-invite-form"));
    expect(await screen.findByTestId("student-link-invite-error")).toBeTruthy();
    expect(screen.queryByTestId("student-link-invite-sent")).toBeNull();
  });
});
