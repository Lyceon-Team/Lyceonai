// @spec [E7b owner ruling 6: harness — real routers, real SQL, real client, auth
//        stubbed to one student, nothing under server/ importing it]
// @implemented [2026-09-25]
//
// plain English: a Node module-resolution hook. When the REAL exam routers (and
// the services they import) ask for the four modules below, they receive this
// harness's stubs instead. Every other import — the routers, the services, the
// shared schemas, the SQL they call — is the production code, unchanged.
//
// It exists only when a process is started with `--import` of register.mjs; the
// production build (vite + esbuild of server/index.ts) never names this directory,
// and scripts/ci/exam-harness-isolation.sh proves it.
//
// @implemented [2026-10-03] (student screenshot harness): a registrant may pass
// `{ data: { keep: ["entitlement-service"] } }` to `register()`; each named module is then
// left as the production module (the student harness runs the REAL EntitlementService over
// the harness Postgres, so free and paid come from real `entitlements` rows). With no data
// the four redirects are exactly as before, so the exam harness is unchanged.
import { URL } from "node:url";

const REDIRECTS = [
  [
    "supabase-server",
    /\/apps\/api\/src\/lib\/supabase-server(\.ts)?$/,
    "./stubs/supabase-server.ts",
  ],
  [
    "supabase-admin",
    /\/apps\/api\/src\/lib\/supabase-admin(\.ts)?$/,
    "./stubs/supabase-admin.ts",
  ],
  [
    "supabase-auth",
    /\/server\/middleware\/supabase-auth(\.js|\.ts)?$/,
    "./stubs/supabase-auth.ts",
  ],
  [
    "entitlement-service",
    /\/server\/services\/entitlement-service(\.ts)?$/,
    "./stubs/entitlement-service.ts",
  ],
];

let active = REDIRECTS;

export async function initialize(data) {
  const keep = Array.isArray(data?.keep) ? data.keep : [];
  for (const name of keep) {
    if (!REDIRECTS.some(([n]) => n === name))
      throw new Error(`hooks.mjs: unknown module to keep: ${name}`);
  }
  active = REDIRECTS.filter(([name]) => !keep.includes(name));
}

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (!resolved.url.startsWith("file:")) return resolved;
  const path = new URL(resolved.url).pathname;
  for (const [, pattern, stub] of active) {
    if (pattern.test(path)) {
      return {
        ...resolved,
        url: new URL(stub, import.meta.url).href,
        shortCircuit: true,
      };
    }
  }
  return resolved;
}
