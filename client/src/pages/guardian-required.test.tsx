// @vitest-environment jsdom
/**
 * @spec [Guardian_Closure_Plan G2-04; owner approval 2026-09-29] | @implemented [2026-09-29]
 *
 * plain English: the /guardian-required page renders the CANONICAL link-code and guardian panels
 * for the signed-in student while the server says a guardian is still needed, and moves on to the
 * dashboard as soon as it says not. The panels are stubbed here to their identity (their own
 * behaviour has its own suites); what this proves is that the page mounts THEM, for THIS student.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GuardianRequired from "./guardian-required";

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));
const signOutMock = vi.hoisted(() => vi.fn(async () => undefined));
let profileData: unknown = undefined;

vi.mock("@tanstack/react-query", () => ({
  useQuery: queryMock.useQuery,
}));

vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) =>
    React.createElement("div", { "data-testid": "redirect", "data-to": to }),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: { id: "kid-1" }, signOut: signOutMock }),
}));

vi.mock("@/components/student/StudentLinkCodePanel", () => ({
  StudentLinkCodePanel: ({ studentId }: { studentId: string }) =>
    React.createElement("div", {
      "data-testid": "canonical-link-code-panel",
      "data-student": studentId,
    }),
}));

vi.mock("@/components/student/StudentGuardiansPanel", () => ({
  StudentGuardiansPanel: ({ studentId }: { studentId: string }) =>
    React.createElement("div", {
      "data-testid": "canonical-guardians-panel",
      "data-student": studentId,
    }),
}));

describe("/guardian-required", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.useQuery.mockImplementation(() => ({ data: profileData }));
  });

  it("renders both canonical panels for the signed-in student while a guardian is needed", () => {
    profileData = { user: { guardianConsentRequired: true } };
    render(React.createElement(GuardianRequired));
    expect(screen.queryByTestId("redirect")).toBeNull();
    expect(
      screen
        .getByTestId("canonical-link-code-panel")
        .getAttribute("data-student"),
    ).toBe("kid-1");
    expect(
      screen
        .getByTestId("canonical-guardians-panel")
        .getAttribute("data-student"),
    ).toBe("kid-1");
    expect(
      screen.getByTestId("guardian-required-sign-out"),
    ).toBeInTheDocument();
  });

  it("asks the server again on an interval, so a guardian's redeem lets the student in", () => {
    profileData = { user: { guardianConsentRequired: true } };
    render(React.createElement(GuardianRequired));
    const options = queryMock.useQuery.mock.calls[0]?.[0] as {
      queryKey: unknown;
      refetchInterval: unknown;
    };
    expect(options.queryKey).toEqual(["/api/profile"]);
    expect(typeof options.refetchInterval).toBe("number");
  });

  it("goes to the dashboard once no guardian is needed", () => {
    profileData = { user: { guardianConsentRequired: false } };
    render(React.createElement(GuardianRequired));
    expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
      "/dashboard",
    );
  });

  it("keeps the panels on screen while the profile is still loading", () => {
    profileData = undefined;
    render(React.createElement(GuardianRequired));
    expect(screen.queryByTestId("redirect")).toBeNull();
    expect(screen.getByTestId("canonical-link-code-panel")).toBeInTheDocument();
  });
});
