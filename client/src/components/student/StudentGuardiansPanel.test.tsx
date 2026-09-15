// @vitest-environment jsdom
/**
 * @spec [Doc-01_V8 §36.3 ("Student profile → Remove guardian → confirmation");
 *        owner brief 2026-09-15 Part A1] | @implemented [2026-09-15]
 *
 * plain English: the student-side "Remove guardian" control. Proves the list is drawn from
 * the links route, that removal is behind an explicit confirmation (no DELETE before the
 * confirm, none on cancel), that the confirm issues the DELETE to the revoke URL for THAT
 * link and with no body (no reason text can travel from here), and that a 409 (already
 * revoked elsewhere) is shown, not swallowed.
 *
 * MOCK BOUNDARY. `csrfFetch` is replaced; nothing else is. The Zod parse and rendering run
 * for real. A React component test, not a data-path test.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const csrfFetchMock = vi.fn();
vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...a: unknown[]) => csrfFetchMock(...a),
}));

import { StudentGuardiansPanel } from "./StudentGuardiansPanel";
import {
  studentLinkRevokeUrl,
  studentLinksUrl,
} from "../../../../packages/shared/src/student-resources";

const STUDENT = "22222222-2222-4222-8222-222222222222";
const LINK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const oneLink = {
  data: {
    links: [
      {
        link_id: LINK,
        guardian_display_name: "Gia Guardian",
        linked_at: "2026-09-10T10:00:00.000Z",
      },
    ],
  },
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudentGuardiansPanel studentId={STUDENT} />
    </QueryClientProvider>,
  );
}

function deleteCalls(): unknown[][] {
  return csrfFetchMock.mock.calls.filter(
    (c) => (c[1] as { method?: string } | undefined)?.method === "DELETE",
  );
}

describe("student guardians panel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists active guardians from the links route", async () => {
    csrfFetchMock.mockResolvedValue(jsonResponse(oneLink));
    renderPanel();
    expect(await screen.findByText("Gia Guardian")).toBeTruthy();
    expect(csrfFetchMock.mock.calls[0]?.[0]).toBe(studentLinksUrl(STUDENT));
    expect(screen.getByTestId(`student-guardian-remove-${LINK}`)).toBeTruthy();
  });

  it("shows the empty state when no guardian is linked", async () => {
    csrfFetchMock.mockResolvedValue(jsonResponse({ data: { links: [] } }));
    renderPanel();
    expect(await screen.findByTestId("student-guardians-empty")).toBeTruthy();
  });

  it("removal requires confirmation: no DELETE on click, none on cancel", async () => {
    csrfFetchMock.mockResolvedValue(jsonResponse(oneLink));
    renderPanel();
    fireEvent.click(
      await screen.findByTestId(`student-guardian-remove-${LINK}`),
    );
    expect(
      await screen.findByTestId("student-guardian-remove-dialog"),
    ).toBeTruthy();
    expect(deleteCalls()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("student-guardian-remove-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("student-guardian-remove-dialog")).toBeNull(),
    );
    expect(deleteCalls()).toHaveLength(0);
  });

  it("confirming issues ONE DELETE to the revoke URL for that link, with no body, and reports the removal", async () => {
    csrfFetchMock.mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return jsonResponse({ data: { link_id: LINK, status: "revoked" } });
        }
        return jsonResponse(oneLink);
      },
    );
    renderPanel();
    fireEvent.click(
      await screen.findByTestId(`student-guardian-remove-${LINK}`),
    );
    fireEvent.click(
      await screen.findByTestId("student-guardian-remove-confirm"),
    );

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    const [url, init] = deleteCalls()[0] as [string, RequestInit];
    expect(url).toBe(studentLinkRevokeUrl(STUDENT, LINK));
    expect(init.body).toBeUndefined();
    expect(
      await screen.findByTestId("student-guardians-removed"),
    ).toHaveTextContent("Gia Guardian can no longer see your progress");
  });

  it("a 409 (already revoked elsewhere) is shown, not swallowed", async () => {
    csrfFetchMock.mockImplementation(
      async (_url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return jsonResponse(
            {
              error: {
                message: "This link is not active",
                code: "LINK_NOT_ACTIVE",
              },
            },
            409,
          );
        }
        return jsonResponse(oneLink);
      },
    );
    renderPanel();
    fireEvent.click(
      await screen.findByTestId(`student-guardian-remove-${LINK}`),
    );
    fireEvent.click(
      await screen.findByTestId("student-guardian-remove-confirm"),
    );
    expect(
      await screen.findByTestId("student-guardians-revoke-error"),
    ).toBeTruthy();
    expect(screen.queryByTestId("student-guardians-removed")).toBeNull();
  });
});
