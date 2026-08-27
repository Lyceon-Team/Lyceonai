#!/usr/bin/env node
/**
 * @spec [Doc 05B §10.3 RB-05B-V1-05 — "route handlers MUST NOT branch into different SQL
 *   predicates or projections by caller role. A single path-layer authorization check ... is
 *   the only permitted role-aware branch"; owner rulings 2026-08-26 R5/R6 and 2026-08-27
 *   (chokepoint gate: "add a role branch -> red")]
 * @implemented 2026-08-27
 *
 * plain English: "every subject-scoped handler must be role-blind" is an ALL-ROUTES property.
 * Any all-routes property is a chokepoint — enforce it once here, never per route, because a
 * per-route convention is one forgotten review away from a divergence.
 *
 * WHAT IT ASSERTS
 *   R1  the scan corpus is non-empty                      (CR-STD-01: zero scanned files is a
 *                                                          broken gate, not a clean tree)
 *   R2  no file registering an /api/students/:studentId route mentions the caller's ROLE
 *   R3  every such route registration is behind `resolveSubject`
 *   R4  the two-argument guardian gate is called from exactly ONE module — the application
 *       mirror of SQL GATE 10 in guardian-view-decision-gate.sql
 *
 * R3 CURRENTLY MATCHES ZERO ROUTES, AND THAT IS STATED RATHER THAN HIDDEN. The resolver ships
 * before the routes it will guard (PR 1 of 4), so R3 is vacuously true today and binds in PR 2
 * when `/api/students/:studentId/...` is first mounted. R1 and R4 have content now. The gate
 * prints the matched-route count on every run so "0" is visible rather than inferred; PR 2
 * flips the expectation to >= 1.
 *
 * MUTATIONS THIS MUST CATCH (each run by hand, see the PR body):
 *   - add `req.user.role` / `isGuardian` inside a subject-scoped handler   -> R2 red
 *   - mount a subject-scoped route without `resolveSubject`                -> R3 red
 *   - call guardian_view_decision from a second module                     -> R4 red
 *   - point the gate at an empty pathspec                                  -> R1 red
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTrackedFiles, parsePathspecOverride } from "./lib/git-tracked-files.mjs";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);

const DEFAULT_PATHSPEC = ["server", "apps/api/src"];
const pathspec = parsePathspecOverride(
  process.env.SUBJECT_CHOKEPOINT_PATHSPEC,
  DEFAULT_PATHSPEC,
);

/** The one module permitted to enter the guardian-visibility derivation. */
const DERIVATION_CALLER = "server/services/guardian-subject.ts";

/**
 * A route is subject-scoped iff its FULL path begins `/api/students/:studentId`. Route files
 * spell paths relative to their mount, so the prefix cannot be read off the registration —
 * `router.get("/students/:studentId/summary")` in guardian-routes.ts mounts at
 * `/api/guardian`, making its full path `/api/guardian/students/:studentId/summary`, which is
 * NOT subject-scoped. Matching the relative string alone flagged all four guardian routes on
 * the first run of this gate. The mount table is therefore resolved from server/index.ts.
 */
const APP_ENTRY = "server/index.ts";
const SUBJECT_MOUNT = "/api/students";

/** `app.use("/api/students", a, b, routerIdent)` — capture the whole call to read its idents. */
const MOUNT_RE = /app\.use\(\s*["'`]\/api\/students["'`]([\s\S]*?)\);/g;
/** `import guardianRoutes from "./routes/guardian-routes";` and named forms. */
const IMPORT_RE = /import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+["'`]([^"'`]+)["'`]/g;

const ROUTE_RE = /\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]*)[`'"]/g;

/**
 * Ways a handler could learn the caller's role. Deliberately includes the string comparisons,
 * not only the property read: `role === "guardian"` is the branch, and it can be written from
 * a destructured local that never spells `req.user.role`.
 */
const ROLE_TELLS = [
  { re: /\breq\.user\??\.role\b/, what: "req.user.role" },
  { re: /\bisGuardian\b/, what: "isGuardian" },
  { re: /\brole\s*===\s*["'`](guardian|student|admin)["'`]/, what: 'role === "<role>"' },
  { re: /\brequireGuardianRole\b/, what: "requireGuardianRole" },
  { re: /\brequireGuardianEntitlement\b/, what: "requireGuardianEntitlement" },
  { re: /\bisGuardianLinkedToStudent\b/, what: "isGuardianLinkedToStudent" },
  { re: /\bgetAllGuardianStudentLinks\b/, what: "getAllGuardianStudentLinks" },
  { re: /\bfrom\(\s*["'`]guardian_links["'`]/, what: 'from("guardian_links")' },
  { re: /\bfrom\(\s*["'`]guardian_consent_requests["'`]/, what: 'from("guardian_consent_requests")' },
];

/** Entering the two-argument derivation. The application mirror of SQL GATE 10. */
const DERIVATION_TELLS = [
  /["'`]guardian_view_decision["'`]/,
  /["'`]guardian_can_view_student_as["'`]/,
];

function resolveSubjectScopedModules(repoRootDir) {
  const entryAbs = resolve(repoRootDir, APP_ENTRY);
  let entry;
  try {
    entry = readFileSync(entryAbs, "utf8");
  } catch {
    return { modules: [], entryMissing: true, directRoutes: 0 };
  }

  const importsByIdent = new Map();
  for (const m of entry.matchAll(IMPORT_RE)) {
    const [, defaultIdent, namedGroup, spec] = m;
    if (defaultIdent) importsByIdent.set(defaultIdent, spec);
    if (namedGroup) {
      for (const raw of namedGroup.split(",")) {
        const ident = raw.trim().split(/\s+as\s+/).pop()?.trim();
        if (ident) importsByIdent.set(ident, spec);
      }
    }
  }

  const modules = new Set();
  for (const m of entry.matchAll(MOUNT_RE)) {
    for (const ident of (m[1].match(/\b[A-Za-z_$][\w$]*\b/g) ?? [])) {
      const spec = importsByIdent.get(ident);
      if (!spec || !spec.startsWith(".")) continue;
      const rel = spec.replace(/^\.\//, "server/").replace(/^\.\.\//, "");
      modules.add(rel.endsWith(".ts") ? rel : `${rel}.ts`);
    }
  }

  // Routes registered directly on `app` under the subject prefix make the entry file itself
  // subject-scoped.
  let directRoutes = 0;
  for (const m of entry.matchAll(ROUTE_RE)) {
    if (m[2].startsWith(`${SUBJECT_MOUNT}/:studentId`)) directRoutes += 1;
  }
  if (directRoutes > 0) modules.add(APP_ENTRY);

  return { modules: [...modules], entryMissing: false, directRoutes };
}

const { files, skippedMissing } = listTrackedFiles({ repoRoot, pathspec });
const sources = files.filter((f) => f.endsWith(".ts") && !f.includes("__tests__") && !f.includes(".test."));

const failures = [];

// ---- R1: the corpus is non-empty -------------------------------------------
if (sources.length === 0) {
  failures.push(
    `R1: zero source files scanned for pathspec [${pathspec.join(", ")}]. ` +
      `Zero scanned files is a broken gate, not a clean tree (CR-STD-01).`,
  );
}

const { modules: subjectModules, entryMissing } = resolveSubjectScopedModules(repoRoot);
if (entryMissing) {
  failures.push(
    `R1: ${APP_ENTRY} could not be read, so the mount table is unknown and no subject-scoped ` +
      `module can be identified. An unreadable entry point is a broken gate, not a clean tree.`,
  );
}

let subjectRouteCount = 0;
const derivationCallers = [];

for (const rel of sources) {
  const text = readFileSync(resolve(repoRoot, rel), "utf8");

  // ---- R4: exactly one module enters the derivation -------------------------
  if (DERIVATION_TELLS.some((re) => re.test(text))) {
    derivationCallers.push(rel);
  }

  if (!subjectModules.includes(rel)) continue;

  const routeCount = [...text.matchAll(ROUTE_RE)].length;
  subjectRouteCount += routeCount;

  // ---- R2: subject-scoped files are role-blind ------------------------------
  for (const tell of ROLE_TELLS) {
    if (tell.re.test(text)) {
      failures.push(
        `R2: ${rel} is mounted under ${SUBJECT_MOUNT} and references \`${tell.what}\`. ` +
          `Below the resolver no handler may learn the caller's role ` +
          `(Doc 05B §10.3 RB-05B-V1-05).`,
      );
    }
  }

  // ---- R3: every subject-scoped route is behind the resolver ----------------
  if (routeCount > 0 && !/\bresolveSubject\b/.test(text)) {
    failures.push(
      `R3: ${rel} registers ${routeCount} route(s) under ${SUBJECT_MOUNT} but never mounts ` +
        `\`resolveSubject\`. A subject-scoped route without the resolver has no path-layer authz.`,
    );
  }
}

if (derivationCallers.length !== 1 || derivationCallers[0] !== DERIVATION_CALLER) {
  failures.push(
    `R4: the guardian-visibility derivation must be entered from exactly one module ` +
      `(${DERIVATION_CALLER}); found [${derivationCallers.join(", ") || "none"}]. ` +
      `A second caller is a second derivation.`,
  );
}

if (skippedMissing.length > 0) {
  console.log(`NOTE: ${skippedMissing.length} tracked path(s) absent from the working tree:`);
  for (const p of skippedMissing) console.log(`  - ${p}`);
}

console.log(
  `subject-resolver chokepoint: ${sources.length} source file(s) scanned; ` +
    `${subjectModules.length} module(s) mounted under ${SUBJECT_MOUNT}; ` +
    `${subjectRouteCount} subject-scoped route registration(s).`,
);
if (subjectRouteCount === 0) {
  console.log(
    "  R3 matched zero routes and is therefore vacuous in this build. The resolver ships " +
      "before the routes it guards; R3 binds when /api/students/:studentId is first mounted.",
  );
}

if (failures.length > 0) {
  console.error("\nSUBJECT-RESOLVER CHOKEPOINT GATE: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("SUBJECT-RESOLVER CHOKEPOINT GATE: PASS");
