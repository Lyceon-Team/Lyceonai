// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Practice from "./practice";

const queryMock = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: queryMock.useQuery,
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "student-1", role: "student" },
    authLoading: false,
  }),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  return {
    Select: ({ children, onValueChange }: any) => (
      <div data-testid="mock-select">
        {ReactModule.Children.map(children, (child) =>
          ReactModule.isValidElement(child)
            ? ReactModule.cloneElement(child as React.ReactElement<any>, { onValueChange })
            : child,
        )}
      </div>
    ),
    SelectTrigger: ({ children, onValueChange: _onValueChange, ...props }: any) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => null,
    SelectContent: ({ children, onValueChange }: any) => (
      <div>
        {ReactModule.Children.map(children, (child) =>
          ReactModule.isValidElement(child)
            ? ReactModule.cloneElement(child as React.ReactElement<any>, { onValueChange })
            : child,
        )}
      </div>
    ),
    SelectItem: ({ value, children, onValueChange }: any) => (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    ),
  };
});

function stubQueryResult(data: unknown) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe("Practice duration link wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.useQuery.mockImplementation(({ queryKey }: { queryKey: unknown }) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
      if (key === "/api/questions/stats") {
        return stubQueryResult({
          total: 100,
          math: 50,
          reading_writing: 50,
          byDifficulty: { easy: 30, medium: 40, hard: 30 },
          recentlyAdded: 10,
        });
      }
      if (key === "/api/practice/topics") {
        return stubQueryResult({ sections: [] });
      }
      if (key === "/api/progress/kpis") {
        return stubQueryResult({ week: { practiceSessions: 0, questionsSolved: 0, accuracy: 0 } });
      }
      if (key === "calendar-streak-practice") {
        return stubQueryResult({ streak: { current: 0, longest: 0 } });
      }
      return stubQueryResult(undefined);
    });
  });

  it("updates practice section links with the selected duration", () => {
    render(<Practice />);

    expect(screen.getByTestId("button-practice-math").closest("a")?.getAttribute("href")).toBe(
      "/practice/math?duration=15",
    );
    expect(screen.getByTestId("button-practice-reading").closest("a")?.getAttribute("href")).toBe(
      "/practice/reading-writing?duration=15",
    );

    fireEvent.click(screen.getByRole("button", { name: "30 minutes" }));

    expect(screen.getByTestId("button-practice-math").closest("a")?.getAttribute("href")).toBe(
      "/practice/math?duration=30",
    );
    expect(screen.getByTestId("button-practice-reading").closest("a")?.getAttribute("href")).toBe(
      "/practice/reading-writing?duration=30",
    );
  });
});
