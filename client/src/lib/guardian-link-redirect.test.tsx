// @vitest-environment jsdom
/**
 * G-NEW-10 — a mid-session unlink moves an under-13 student to /guardian-required at once.
 *
 * @spec [Guardian_Closure_Plan G-NEW-10 named proof: "an RTL test: a 403 GUARDIAN_LINK_REQUIRED
 *       from any learning request routes the student to /guardian-required"; G2-04 (the server
 *       refuses every learning request with that code); owner ruling R6] | @implemented [2026-09-30]
 *
 * plain English: a component on the APP's query client (the one every page uses) reads a
 * learning endpoint and is refused with 403 GUARDIAN_LINK_REQUIRED — the answer the G2-04 gate
 * gives once the student's last active guardian link is revoked. The query cache's one error
 * hook sends the browser to /guardian-required, as a full navigation so `RequireRole`'s cached
 * `/api/profile` (staleTime Infinity) is re-read and agrees. A mutation refused the same way
 * does the same. Before this, the student stayed on the page watching refused requests until
 * the next reload.
 */
import { render, waitFor } from "@testing-library/react";
import {
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUARDIAN_LINK_REQUIRED } from "@lyceon/shared/guardian-link-gate";
import { HttpApiError } from "./api-error";
import { navigation, queryClient } from "./queryClient";

const refused = (): HttpApiError =>
  new HttpApiError({
    status: 403,
    message: "A guardian needs to connect to your account.",
    code: GUARDIAN_LINK_REQUIRED,
  });

function LearningRead(): null {
  useQuery({
    queryKey: ["/api/practice/sessions/current"],
    queryFn: async () => {
      throw refused();
    },
  });
  return null;
}

function LearningWrite(): null {
  const { mutate } = useMutation({
    mutationFn: async () => {
      throw refused();
    },
  });
  useEffect(() => mutate(), [mutate]);
  return null;
}

let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.history.replaceState({}, "", "/practice");
  queryClient.clear();
  assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
});
afterEach(() => {
  assign.mockRestore();
  queryClient.clear();
});

describe("G-NEW-10 GUARDIAN_LINK_REQUIRED mid-session", () => {
  it.each([
    ["a query", LearningRead],
    ["a mutation", LearningWrite],
  ])(
    "%s refused with it sends the student to /guardian-required",
    async (_n, C) => {
      render(
        <QueryClientProvider client={queryClient}>
          <C />
        </QueryClientProvider>,
      );
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith("/guardian-required"),
      );
      expect(assign).toHaveBeenCalledTimes(1);
    },
  );

  it("does not loop when already on /guardian-required", async () => {
    window.history.replaceState({}, "", "/guardian-required");
    render(
      <QueryClientProvider client={queryClient}>
        <LearningRead />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(assign).not.toHaveBeenCalled();
  });
});
