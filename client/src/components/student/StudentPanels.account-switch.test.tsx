// @vitest-environment jsdom
/**
 * G-NEW-11 — one browser tab, two students: B's session must never request A's link code or links.
 *
 * @spec [Guardian_Closure_Plan G-NEW-11; production 2026-09-30 02:19:19–44Z: profile 3f18cbe2
 *       requested /api/students/3e42e0cd…/link-code and /links (404), 3e42e0cd being the student
 *       who used the tab before] | @implemented [2026-09-30]
 *
 * plain English: mounts the REAL `SupabaseAuthProvider` and the REAL Settings panels
 * (`StudentLinkCodePanel`, `StudentGuardiansPanel`), fed `user.id` from the auth context exactly
 * as `UserProfile` does, under one React Query client with the app's defaults. Only the network
 * is scripted. Every request URL is logged; once A's session has ended, no URL may carry A's id.
 *
 * Switches covered: sign-out then sign-in in this tab; a profile refresh answering for a
 * different person while the panels stay mounted; and the production path — the session changed
 * in ANOTHER tab, noticed here when the tab regains focus or when the other tab announces it.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STUDENT_A = "3e42e0cd-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDENT_B = "3f18cbe2-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const net = vi.hoisted(() => ({
  signedIn: null as string | null,
  log: [] as string[],
  /** When set, GET /api/profile answers this status instead (a failing server). */
  profileStatus: null as number | null,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(async () => "t"),
  clearCsrfToken: vi.fn(),
  csrfFetch: vi.fn(async (url: string, init?: RequestInit) => {
    net.log.push(url);
    if (url === "/api/auth/signout") {
      net.signedIn = null;
      return json({ ok: true });
    }
    if (url === "/api/auth/signin") {
      const body = JSON.parse(String(init?.body)) as { email: string };
      net.signedIn = body.email.startsWith("a@") ? STUDENT_A : STUDENT_B;
      return json({ ok: true });
    }
    if (url === "/api/profile") {
      if (net.profileStatus !== null)
        return json({ error: "unavailable" }, net.profileStatus);
      if (!net.signedIn) return json({ authenticated: false }, 401);
      return json({
        user: {
          id: net.signedIn,
          email:
            net.signedIn === STUDENT_A ? "a@example.test" : "b@example.test",
          display_name: net.signedIn === STUDENT_A ? "Student A" : "Student B",
          role: "student",
        },
      });
    }
    const m = /^\/api\/students\/([^/]+)\/(link-code|links)$/.exec(url);
    if (m) {
      // The server answers for the session's own id only; anyone else's is a 404.
      if (decodeURIComponent(m[1]!) !== net.signedIn) {
        return json({ error: { message: "Not found" } }, 404);
      }
      return m[2] === "link-code"
        ? json({
            data: {
              code: m[1] === STUDENT_A ? "AAAAAA" : "BBBBBB",
              expiresAt: "2026-10-01T00:00:00.000Z",
            },
          })
        : json({ data: { links: [] } });
    }
    throw new Error(`unscripted request ${url}`);
  }),
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseBrowserClient: () => ({}) }));
vi.mock("@/components/legal/reconsent-dismissal", () => ({
  clearReconsentDismissal: vi.fn(),
}));

import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "@/contexts/SupabaseAuthContext";
import { StudentLinkCodePanel } from "./StudentLinkCodePanel";
import { StudentGuardiansPanel } from "./StudentGuardiansPanel";

let auth: ReturnType<typeof useSupabaseAuth> | null = null;
/** Whether this "tab" is on the Settings page (panels mounted) or elsewhere (dashboard). */
const page = { settings: true };
let rerender: (() => void) | null = null;
function SettingsHarness(): JSX.Element {
  auth = useSupabaseAuth();
  const [, force] = React.useState(0);
  rerender = () => force((n) => n + 1);
  if (auth.user?.id && !page.settings) return <p>dashboard</p>;
  // As UserProfile renders them: the signed-in student's own id, from the auth context.
  return auth.user?.id ? (
    <>
      <StudentLinkCodePanel studentId={auth.user.id} />
      <StudentGuardiansPanel studentId={auth.user.id} />
    </>
  ) : (
    <p>signed out</p>
  );
}

function mount(): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <SupabaseAuthProvider>
        <SettingsHarness />
      </SupabaseAuthProvider>
    </QueryClientProvider>,
  );
}

const requestsFor = (id: string, from: number): string[] =>
  net.log.slice(from).filter((u) => u.includes(`/api/students/${id}/`));

describe("G-NEW-11 the student Settings panels follow the signed-in student", () => {
  beforeEach(() => {
    net.signedIn = STUDENT_A;
    net.log.length = 0;
    net.profileStatus = null;
    auth = null;
    page.settings = true;
  });

  it("A signs out, B signs in: no request goes to A's id, and B's code is shown", async () => {
    mount();
    // Presence first: A's own panels really fetched and rendered A's code.
    expect(await screen.findByText("AAAAAA")).toBeInTheDocument();
    expect(requestsFor(STUDENT_A, 0).length).toBeGreaterThan(0);

    await act(async () => {
      await auth!.signOut();
    });
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    const mark = net.log.length;

    await act(async () => {
      await auth!.signIn("b@example.test", "pw");
    });
    expect(await screen.findByText("BBBBBB")).toBeInTheDocument();
    await waitFor(() =>
      expect(requestsFor(STUDENT_B, mark).length).toBeGreaterThanOrEqual(2),
    );
    expect(requestsFor(STUDENT_A, mark)).toEqual([]);
    expect(screen.queryByText("AAAAAA")).toBeNull();
  });

  it("the session changes to B while the panels stay mounted: no request goes to A's id", async () => {
    mount();
    expect(await screen.findByText("AAAAAA")).toBeInTheDocument();

    // Another tab signs in as B on the shared cookie; this tab's next profile read answers B.
    net.signedIn = STUDENT_B;
    const mark = net.log.length;
    await act(async () => {
      await auth!.refreshUser();
    });
    expect(await screen.findByText("BBBBBB")).toBeInTheDocument();
    await waitFor(() =>
      expect(requestsFor(STUDENT_B, mark).length).toBeGreaterThanOrEqual(2),
    );
    expect(requestsFor(STUDENT_A, mark)).toEqual([]);
    expect(screen.queryByText("AAAAAA")).toBeNull();
  });

  // THE PRODUCTION PATH. The session cookie is shared by every tab of the browser. A signs out
  // and B signs in somewhere this tab's auth functions never ran (another tab, or an emailed
  // sign-in link that opens one). This tab still holds A, so the next time it mounts the Settings
  // panels they ask for A's link code and links with B's cookie: the 404s at 02:19:19–44Z.
  it("the session changes to B in another tab; back in this tab, Settings asks for B, never A", async () => {
    mount();
    expect(await screen.findByText("AAAAAA")).toBeInTheDocument();

    // This tab moves to the dashboard; the panels unmount.
    page.settings = false;
    act(() => rerender!());
    expect(await screen.findByText("dashboard")).toBeInTheDocument();

    // Elsewhere: A signs out, B signs in. Nothing in this tab ran.
    net.signedIn = STUDENT_B;
    const mark = net.log.length;

    // The student comes back to this tab and opens Settings.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(auth!.user?.id).toBe(STUDENT_B));
    page.settings = true;
    act(() => rerender!());

    expect(await screen.findByText("BBBBBB")).toBeInTheDocument();
    expect(requestsFor(STUDENT_A, mark)).toEqual([]);
    expect(screen.queryByText("AAAAAA")).toBeNull();
  });

  // The same path when this tab never cached A's panels: the first mount goes to the network
  // with A's id and B's cookie. This is the request pair production logged (404, 404).
  it("A never opened Settings here; after the switch elsewhere, the first Settings mount asks for B", async () => {
    page.settings = false;
    mount();
    expect(await screen.findByText("dashboard")).toBeInTheDocument();

    net.signedIn = STUDENT_B;
    const mark = net.log.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(auth!.user?.id).toBe(STUDENT_B));
    page.settings = true;
    act(() => rerender!());

    expect(await screen.findByText("BBBBBB")).toBeInTheDocument();
    expect(requestsFor(STUDENT_A, mark)).toEqual([]);
  });

  // The other tab announces its sign-in; this tab switches without waiting to be focused.
  it("another tab announces the change: this tab moves to B with no focus event", async () => {
    mount();
    expect(await screen.findByText("AAAAAA")).toBeInTheDocument();

    net.signedIn = STUDENT_B;
    const mark = net.log.length;
    const otherTab = new BroadcastChannel("lyceon-auth-change");
    otherTab.postMessage("changed");
    otherTab.close();

    expect(await screen.findByText("BBBBBB")).toBeInTheDocument();
    expect(requestsFor(STUDENT_A, mark)).toEqual([]);
    expect(screen.queryByText("AAAAAA")).toBeNull();
  });

  // Re-validation must not sign anyone out on a failing server: only a real answer moves the tab.
  it("a focus while the server fails changes nothing", async () => {
    mount();
    expect(await screen.findByText("AAAAAA")).toBeInTheDocument();

    net.profileStatus = 503;
    const mark = net.log.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(net.log.slice(mark)).toContain("/api/profile"));
    expect(auth!.user?.id).toBe(STUDENT_A);
    expect(screen.getByText("AAAAAA")).toBeInTheDocument();
  });
});
