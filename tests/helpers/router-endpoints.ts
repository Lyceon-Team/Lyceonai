/**
 * Every /api endpoint of the REAL Express app, read from its router, with the gate functions
 * present in each endpoint's middleware chain.
 *
 * @spec [Guardian_Closure_Plan G1-11, G2-04] | @implemented [2026-09-29]
 *
 * plain English: walks `app._router.stack` — top-level routes, and every sub-router mounted with
 * `app.use(path, …, router)` — and reports method, full path and which of the caller's gate
 * functions appear in the chain (mount-level siblings and route-level handlers alike), matched by
 * FUNCTION IDENTITY, never by name or path. A route added anywhere is in the list the moment it
 * exists, so a sweep built on this cannot go stale. Shared by the G1-11 guardian denial sweep and
 * the G2-04 under-13 link-gate sweep: one walker, so the two cannot disagree about what the app
 * serves.
 */
import type { Express } from "express";

type RouteLike = {
  path: string;
  methods: Record<string, boolean>;
  stack: Array<{ handle: unknown }>;
};
type LayerLike = {
  name: string;
  handle: unknown;
  route?: RouteLike;
  regexp?: RegExp & { fast_slash?: boolean };
};

export type Endpoint<G extends string> = {
  method: string;
  path: string;
  gates: G[];
};

/** Express 4 keeps a mount's path only as a regexp; recover the literal prefix. */
function mountPath(layer: LayerLike): string {
  if (!layer.regexp || layer.regexp.fast_slash) return "";
  return layer.regexp.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\//g, "/");
}

export function collectEndpoints<G extends string>(
  app: Express,
  gateOf: (handle: unknown) => G | null,
): Endpoint<G>[] {
  const stack = (app as unknown as { _router: { stack: LayerLike[] } })._router
    .stack;
  const endpoints: Endpoint<G>[] = [];
  const gatesIn = (handles: Array<{ handle: unknown }>): G[] =>
    handles.map((s) => gateOf(s.handle)).filter((g): g is G => g !== null);
  for (const layer of stack) {
    if (layer.route) {
      const gates = gatesIn(layer.route.stack);
      for (const method of Object.keys(layer.route.methods)) {
        endpoints.push({ method, path: layer.route.path, gates });
      }
    } else if (layer.name === "router") {
      const mount = mountPath(layer);
      // `app.use(path, a, b, router)` registers a, b and router as sibling layers that share
      // the mount's regexp; the gates among the siblings apply to every route in the router.
      const mountGates = gatesIn(
        stack.filter(
          (l) =>
            !l.route &&
            l.name !== "router" &&
            mountPath(l) === mount &&
            l.regexp?.source === layer.regexp?.source,
        ),
      );
      const sub = (layer.handle as { stack: LayerLike[] }).stack;
      for (const r of sub) {
        if (!r.route) continue;
        const routeGates = gatesIn(r.route.stack);
        for (const method of Object.keys(r.route.methods)) {
          endpoints.push({
            method,
            path: `${mount}${r.route.path}`,
            gates: [...mountGates, ...routeGates],
          });
        }
      }
    }
  }
  return endpoints.filter((e) => e.path.startsWith("/api/"));
}
