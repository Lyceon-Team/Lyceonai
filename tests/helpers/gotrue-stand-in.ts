/**
 * A stand-in for the four GoTrue endpoints the password paths call: password grant, update user,
 * logout, and admin get-user.
 *
 * @spec [Brief 8 ruling 4 (owner, 2026-10-01); F-38; student-UI register OQ-26 (owner ruling
 *        2026-10-02)] | @implemented [2026-10-03]
 *
 * plain English: ONE scenario, shared. `account-password-change.test.ts` (the change-password
 * route) and `profile-has-password.pg.ci.test.ts` (GET /api/profile `hasPassword`) both drive the
 * REAL `@supabase/supabase-js` clients and the REAL `server/lib/password-credentials.ts` against
 * this transport, so the identity list the profile reports and the identity list the route
 * refuses on come from the same stand-in, never from two hand-built fixtures that could drift.
 * Extracted verbatim from `account-password-change.test.ts` (2026-10-03); `failAdminRead` was
 * added for the profile's failed-read case.
 *
 * Only the transport is substituted. What a test proves is what auth-js actually sends.
 */
import { createClient } from "@supabase/supabase-js";
import type { PasswordAuthClients } from "../../server/lib/password-credentials";

export const GOTRUE = "https://gotrue.test";

export type GoTrueAccount = { id: string; email: string };

export type GoTrueStandIn = {
  password: string;
  providers: string[];
  sessions: Map<string, string>;
  calls: string[];
  updatedWithToken: string | null;
  failTokenWith500: boolean;
  /** GET /admin/users/:id answers 500: the identity read fails. */
  failAdminRead: boolean;
};

export type GoTrueHarness = {
  state: GoTrueStandIn;
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  /** The verifier and admin clients `setPasswordAuthClientsForTests` takes. */
  clients: () => PasswordAuthClients;
};

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createGoTrueStandIn(
  account: GoTrueAccount,
  initialPassword: string,
): GoTrueHarness {
  const state: GoTrueStandIn = {
    password: initialPassword,
    providers: ["email"],
    sessions: new Map(),
    calls: [],
    updatedWithToken: null,
    failTokenWith500: false,
    failAdminRead: false,
  };
  let issued = 0;

  function userJson(): Record<string, unknown> {
    return {
      id: account.id,
      aud: "authenticated",
      role: "authenticated",
      email: account.email,
      app_metadata: {
        provider: state.providers[0],
        providers: state.providers,
      },
      user_metadata: {},
      identities: state.providers.map((provider) => ({
        id: `${provider}-identity`,
        identity_id: `${provider}-identity`,
        user_id: account.id,
        provider,
        identity_data: {},
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      })),
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  async function standInFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const bearer = new Headers(init?.headers)
      .get("authorization")
      ?.replace(/^Bearer /i, "");
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    state.calls.push(`${method} ${path}${url.search}`);

    if (
      method === "POST" &&
      path === "/token" &&
      url.searchParams.get("grant_type") === "password"
    ) {
      if (state.failTokenWith500)
        return json(500, { code: "unexpected_failure", msg: "boom" });
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        email?: string;
        password?: string;
      };
      if (
        body.email !== account.email ||
        body.password !== state.password ||
        !state.providers.includes("email")
      ) {
        return json(400, {
          code: "invalid_credentials",
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
        });
      }
      issued += 1;
      const token = `verification-token-${issued}`;
      state.sessions.set(token, account.id);
      return json(200, {
        access_token: token,
        refresh_token: `refresh-${issued}`,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: userJson(),
      });
    }
    if (method === "PUT" && path === "/user") {
      if (!bearer || !state.sessions.has(bearer))
        return json(401, { code: "bad_jwt", msg: "invalid" });
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        password?: string;
      };
      if (body.password) {
        state.password = body.password;
        state.updatedWithToken = bearer;
      }
      return json(200, userJson());
    }
    if (method === "POST" && path === "/logout") {
      if (bearer) state.sessions.delete(bearer);
      return json(204, null);
    }
    if (method === "GET" && path === `/admin/users/${account.id}`) {
      if (state.failAdminRead)
        return json(500, { code: "unexpected_failure", msg: "boom" });
      return json(200, userJson());
    }
    return json(404, { code: "not_found", msg: `${method} ${path}` });
  }

  const clientOptions = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: standInFetch },
  };

  return {
    state,
    fetch: standInFetch,
    clients: () => ({
      verifier: () => createClient(GOTRUE, "anon-key", clientOptions),
      admin: () => createClient(GOTRUE, "service-key", clientOptions),
    }),
  };
}
