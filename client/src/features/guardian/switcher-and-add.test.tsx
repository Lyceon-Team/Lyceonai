// @vitest-environment jsdom
/**
 * G4-02 — the student switcher and the Add-student modal.
 *
 * @spec [Guardian_Closure_Plan G4-02 named proofs: "switching changes the URL and no element
 *       from the previous student renders; a successful redeem adds the student and navigates
 *       to it; a 429 shows the rate-limit copy"] | @implemented [2026-09-30]
 */
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
  BO,
  CY,
  GUARDIAN_AUTH,
  json,
  mountApp,
  net,
  roster,
  scriptedFetch,
} from "./test-harness";

vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const { GUARDIAN_AUTH: auth } = await import("./test-harness");
  return {
    useSupabaseAuth: () => ({ ...auth, signOut: vi.fn(async () => undefined) }),
  };
});
vi.mock("@/lib/csrf", async () => {
  const { scriptedFetch: fetcher } = await import("./test-harness");
  return {
    getCsrfToken: vi.fn(async () => "t"),
    clearCsrfToken: vi.fn(),
    csrfFetch: vi.fn(fetcher),
  };
});

const { Router } = await import("@/App");
void GUARDIAN_AUTH;
void scriptedFetch;

beforeEach(() => {
  net.reset();
  net.roster = roster([
    { id: ADA, name: "Ada" },
    { id: BO, name: "Bo", lapsed: true },
  ]);
});
afterEach(cleanup);

async function openSwitcher(): Promise<void> {
  const trigger = await screen.findByTestId("student-switcher");
  await waitFor(() => expect(trigger.textContent).toContain("Ada"));
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}

describe("G4-02 the student switcher", () => {
  it("switching changes the URL and nothing from the previous student renders", async () => {
    const { history } = mountApp(Router, `/guardian/${ADA}`);
    await openSwitcher();
    // The lapsed student is marked in the list — shown, not hidden.
    expect(await screen.findByTestId("student-switcher-lapsed")).toBeTruthy();
    const mark = net.log.length;
    fireEvent.click(await screen.findByTestId(`student-switcher-item-${BO}`));

    await waitFor(() =>
      expect(history[history.length - 1]).toBe(`/guardian/${BO}`),
    );
    await waitFor(() =>
      expect(screen.getByTestId("student-switcher").textContent).toContain(
        "Bo",
      ),
    );
    // Nothing on the page names or reads the previous student any more.
    expect(screen.queryByText("Ada")).toBeNull();
    expect(
      net.log.slice(mark).some((l) => l.includes(`/students/${ADA}/`)),
    ).toBe(false);
  });

  it("switching on the Calendar tab keeps the Calendar tab", async () => {
    const { history } = mountApp(Router, `/guardian/${ADA}/calendar`);
    await openSwitcher();
    fireEvent.click(await screen.findByTestId(`student-switcher-item-${BO}`));
    await waitFor(() =>
      expect(history[history.length - 1]).toBe(`/guardian/${BO}/calendar`),
    );
  });
});

describe("G4-02 the Add-student modal", () => {
  async function submitCode(code: string): Promise<void> {
    fireEvent.click(await screen.findByTestId("add-student-open"));
    fireEvent.change(await screen.findByTestId("add-student-code"), {
      target: { value: code },
    });
    fireEvent.click(screen.getByTestId("add-student-terms"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-student-submit"));
    });
  }

  it("a successful redeem adds the student and navigates to them", async () => {
    net.handlers.push((url, init) => {
      if (url !== "/api/guardian/link/redeem" || init?.method !== "POST")
        return;
      // The server links Cy; the roster refetch now lists them.
      net.roster = roster([
        { id: ADA, name: "Ada" },
        { id: BO, name: "Bo", lapsed: true },
        { id: CY, name: "Cy" },
      ]);
      return json(
        { data: { link_id: "link-cy", student_profile_id: CY } },
        201,
      );
    });
    const { history } = mountApp(Router, `/guardian/${ADA}`);
    await submitCode("abc 234");

    expect(net.log).toContain("POST /api/guardian/link/redeem");
    await waitFor(() =>
      expect(history[history.length - 1]).toBe(`/guardian/${CY}`),
    );
    await waitFor(() =>
      expect(screen.getByTestId("student-switcher").textContent).toContain(
        "Cy",
      ),
    );
    expect(screen.queryByTestId("add-student-dialog")).toBeNull();
  });

  it("a 429 shows the rate-limit copy — by status, whatever the message says", async () => {
    net.handlers.push((url) =>
      url === "/api/guardian/link/redeem"
        ? json({ error: { message: "slow down", code: "RATE_LIMITED" } }, 429)
        : undefined,
    );
    mountApp(Router, `/guardian/${ADA}`);
    await submitCode("ABC234");
    expect((await screen.findByTestId("add-student-error")).textContent).toBe(
      "Too many attempts. Please wait 15 minutes before trying again.",
    );
  });

  it("a guardian with no date of birth is asked for it, then the same code is redeemed", async () => {
    let dobSaved = false;
    net.handlers.push((url, init) => {
      if (url === "/api/profile/date-of-birth") {
        dobSaved = true;
        return json({ ok: true });
      }
      if (url === "/api/guardian/link/redeem" && init?.method === "POST") {
        return dobSaved
          ? json({ data: { link_id: "l", student_profile_id: ADA } }, 201)
          : json(
              {
                error: {
                  code: "GUARDIAN_DATE_OF_BIRTH_REQUIRED",
                  message:
                    "Add your date of birth to your account before linking a student.",
                },
              },
              403,
            );
      }
      return undefined;
    });
    const { history } = mountApp(Router, `/guardian/${BO}`);
    await submitCode("ABC234");
    fireEvent.change(await screen.findByTestId("add-student-dob-input"), {
      target: { value: "1980-01-01" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-student-submit"));
    });
    await waitFor(() =>
      expect(history[history.length - 1]).toBe(`/guardian/${ADA}`),
    );
    expect(
      net.log.filter((l) => l === "POST /api/guardian/link/redeem"),
    ).toHaveLength(2);
  });
});
