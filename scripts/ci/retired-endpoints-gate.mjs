#!/usr/bin/env node
/**
 * @spec [owner ruling 2026-08-21 Q4 — "/domains supersedes /summary. Two endpoints
 *   returning the same data in different shapes is how SAT_TAXONOMY happened. Once PR D's
 *   consumers move, it goes, with a gate asserting no caller remains."]
 * @implemented 2026-08-21
 *
 * plain English: once an endpoint is retired, this fails the build if ANY reference to its
 * path survives anywhere in the tree — client, server, tests, scripts or docs.
 *
 * WHY A GATE AND NOT JUST A DELETION.
 *   Deleting a route handler removes the server half. The caller half fails at RUNTIME, as
 *   a 404 the UI renders as an error state or an empty list — which is the fail-open shape
 *   this codebase keeps rediscovering: a broken read wearing the face of "no data". A
 *   forgotten caller is invisible to `tsc` because the path is a string. Only a text search
 *   over the committed tree can see it, so that is what runs.
 *
 *   The rule generalises past this one endpoint, which is why the retired set is a table
 *   rather than a hardcoded string: retiring the NEXT endpoint means adding one row, and
 *   the gate that proves nobody still calls it comes free.
 *
 * REPLACEMENT IS PART OF THE ENTRY. A failure that only says "this is gone" makes the
 * reader go hunting. Each row names what to call instead, and the failure prints it.
 *
 * MUTATIONS THIS MUST CATCH (verified by scripts/ci/retired-endpoints-gate.selftest.sh):
 *   - reintroduce a fetch/queryKey for a retired path anywhere → EXIT 1, names file:line
 *   - point the gate at zero files                             → EXIT 1. Zero scanned files
 *     is not zero callers: a glob that stops matching reports "clean" forever.
 *   - empty the RETIRED table                                  → EXIT 1. A gate with nothing
 *     to check is a gate that cannot fail, which is not the same as a clean tree.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  listTrackedFiles,
  parsePathspecOverride,
} from "./lib/git-tracked-files.mjs";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);

/**
 * Retired paths. Add a row when an endpoint is deleted; never remove one — a path that
 * stops being checked is a path that can quietly come back.
 */
const RETIRED = [
  {
    path: "/api/me/mastery/summary",
    retiredIn: "PR D (owner ruling 2026-08-21 Q4)",
    replacement:
      "GET /api/me/mastery/domains — same domain grain, carrying levelKey/level/displayName",
  },
  {
    path: "/api/me/mastery/skills",
    retiredIn:
      "PR C (it joined against SAT_TAXONOMY and could never return data)",
    replacement:
      "GET /api/me/mastery/domains/:section/:domain/skills — the drill-down's second screen",
  },
  {
    path: "/api/me/mastery/add-to-plan",
    retiredIn: "PR C (owner ruling 2026-08-20 RULE 10)",
    replacement:
      "nothing — planner ownership lives in the /api/calendar day edit and regenerate flows",
  },
  // --- Guardian rebuild PR 2 (owner ruling 2026-08-27) ---------------------
  // The whole /api/me/mastery family moved onto the subject-scoped topology Doc 05B §10.3
  // specifies. The route prefix is retired, not just the individual paths: under the single-
  // route contract there is no "my" resource distinct from "this student's" resource.
  // NAMED PATHS, NOT THE `/api/me/mastery` PREFIX. A prefix entry also matched
  // `tests/ci/forbidden-routes.ci.test.ts` and `runtime-law-lockdown.ci.test.ts`, which
  // assert that `/api/me/mastery/diagnostic` is ABSENT — a negative assertion about a
  // different route is not a caller, and a gate that flags one trains people to wave it
  // through.
  {
    path: "/api/me/mastery/domains",
    retiredIn: "PR 2 (Doc 05B §10.3 single-route contract)",
    replacement:
      "GET /api/students/:studentId/mastery/domains and /mastery/skills — one route each, served to the student and to a linked guardian by the same handler",
  },
  {
    path: "/api/me/mastery/weakest",
    retiredIn: "PR 2 (owner ruling 2026-08-27 OQ4)",
    replacement:
      "nothing — no document specifies a weakest-skills route, and it ordered by mastery_score, which Parent AC#20 confines to admin/internal. Ordering by a forbidden column is a projection of it",
  },
  {
    path: "/api/me/weakness/skills",
    retiredIn: "PR 2 (owner ruling 2026-08-27 OQ4)",
    replacement:
      "nothing — no document specifies a weakest-skills route, and this one ordered by mastery_score, which Parent AC#20 confines to admin/internal. Ordering by a forbidden column is a projection of it",
  },
  {
    path: "/api/guardian/weaknesses",
    retiredIn: "PR 2 (Doc 05B §10.3)",
    replacement:
      "GET /api/students/:studentId/mastery/domains — the guardian read IS the student query",
  },
  // --- Guardian delete-and-ship (owner instruction 2026-08-28) --------------
  // The guardian surface is four things: link, gate, resolver, view. These served none of
  // them. Deleted rather than refactored, so what remains traces to a scope item or to a
  // spec section and nothing else.
  {
    path: "/api/consent",
    retiredIn:
      "delete-and-ship (Doc 10 §2.4 + 07E §10.1 — under-13 is hard-delete-everywhere, not consent-grants-access)",
    replacement:
      "nothing, deliberately. There is no under-13 signup path to preserve, so there is nothing to collect parental consent for. The surface also could not run: it queried child_id/expires_at against a table with student_profile_id/consent_token_expires_at",
  },
  {
    path: "/api/guardian/students/:studentId/exams/full-length/sessions",
    retiredIn: "delete-and-ship (outside the four-item guardian scope)",
    replacement:
      "nothing — guardian exam history is not one of link / gate / resolver / view, and Doc 04C §12.4 explicitly disclaims guardian multi-session aggregation",
  },
  {
    path: "/api/guardian/students/:studentId/tests/:sessionId/report",
    retiredIn: "delete-and-ship (outside the four-item guardian scope)",
    replacement: "nothing — see above",
  },
  {
    path: "/api/guardian/students/:studentId/calendar/month",
    retiredIn: "delete-and-ship (outside the four-item guardian scope)",
    replacement:
      "nothing — SCL-076 already recorded that five locked passages NAME a guardian calendar and none SPECIFIES one. Recreating from spec is cheaper than carrying drift",
  },
  {
    path: "/api/guardian/students/:studentId/summary",
    retiredIn: "PR 2 (Doc 05B §10.3)",
    replacement:
      "GET /api/students/:studentId/kpi/overall — the same envelope, one route",
  },
  {
    path: "/exams/full-length/:sessionId/report",
    retiredIn: "PR 2 (renamed to match Doc 04C §895)",
    replacement:
      "nothing. This entry USED to point at GET /api/guardian/students/:studentId/tests/:sessionId/report, which was itself deleted 2026-08-28 as outside the four-item guardian scope — so a replacement that named it would send the reader to a second dead route. A retired entry whose replacement is also retired is how a deletion chain goes stale",
  },
];

/**
 * This file names every retired path, so it would match itself. So would a changelog entry
 * describing the retirement. Both are documentation of the deletion rather than callers of
 * the deleted thing, and the distinction has to be drawn somewhere explicit.
 */
const SELF_REFERENTIAL = new Set([
  "scripts/ci/retired-endpoints-gate.mjs",
  "scripts/ci/retired-endpoints-gate.selftest.sh",
  // These two documents EXIST to record the guardian migration — the audit that found the
  // routes and the plan that retired them. Every retired path appears in them by necessity,
  // as history. Kept deliberately short: an exemption list is an allowlist, and an allowlist
  // grows a blind spot every time something is added to it, so nothing joins this set unless
  // its whole purpose is describing a deletion.
  "docs/SpecAudit/guardian-rebuild-design-spec.md",
  "docs/SpecAudit/guardian-route-topology-migration-plan.md",
  // Added 2026-08-28 with the delete-and-ship pass. Same test as above and no looser: each of
  // these exists to RECORD a deletion, and every retired path appears in it as history.
  //   - SPEC_CHANGES_LOG is the append-only SCL register. Editing a past entry to satisfy a
  //     gate would falsify the record the register exists to keep.
  //   - consent-flow-preflight-audit is the audit that established the consent flow could not
  //     run; naming `/api/consent` is its subject.
  //   - WS-GL_Stage1_Audit is the audit that found the surface in the first place.
  //   - ws0-stop-the-bleed.contract records a defect in a route that has since been deleted.
  // A live document that ADVERTISES a deleted route is a different thing and was fixed, not
  // exempted: six of them were edited in this same change.
  "docs/SpecAudit/SPEC_CHANGES_LOG.md",
  "docs/SpecAudit/consent-flow-preflight-audit.md",
  "docs/plans/WS-GL_Stage1_Audit.md",
  "contracts/ws0-stop-the-bleed.contract.md",
]);

/**
 * SCOPE IS A DENYLIST, NOT AN EXTENSION ALLOWLIST.
 *
 *   This gate previously listed the extensions it would read — `*.ts *.tsx *.js *.mjs *.md
 *   *.yml *.yaml`. That covered 833 of 1291 tracked files and silently ignored the other
 *   458: 197 `.sql`, 36 `.sh`, 29 `.json`, 7 `.py`, 2 `.html`. A URL string can live in any
 *   of them — a curl in a shell script, a Postman export, a fixture — and the gate reported
 *   a clean tree while `postman/Lyceonai.postman_collection.json:514` called a retired
 *   endpoint.
 *
 *   An allowlist of extensions IS a silent-exclusion mechanism: it grows a blind spot every
 *   time the repo gains a file type, and nothing announces it. So the scope is inverted.
 *   Everything tracked is read EXCEPT what cannot contain a readable URL (binaries) and the
 *   two directories excluded for stated reasons below. A new file type is in scope the day
 *   it lands, with no one having to remember.
 *
 * `docs/Spec/**` is the locked canonical corpus — read-only by standing rule, and not a
 * caller. `audit-out/**` holds dated point-in-time audit reports: a record of what the tree
 * looked like on a given day, which stays true even after the endpoint goes. Editing either
 * to satisfy a gate would be falsifying a record, so they are out of scope rather than
 * quietly rewritten. Everything else — live docs, contracts, code, tests, collections,
 * scripts, SQL — is in scope.
 */
const BINARY_EXTENSIONS = [
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff",
  "woff", "woff2", "ttf", "otf", "eot",
  "zip", "gz", "tgz", "tar", "bz2", "7z", "rar",
  "mp3", "mp4", "wav", "mov", "avi", "webm",
  "wasm", "so", "dylib", "dll", "exe", "bin", "class", "jar",
];

const DEFAULT_PATHSPEC = [
  ".",
  ":(exclude)docs/Spec/**",
  ":(exclude)audit-out/**",
  ":(exclude)**/node_modules/**",
  ":(exclude)dist/**",
  ...BINARY_EXTENSIONS.map((ext) => `:(exclude)*.${ext}`),
];

/**
 * RETIRED_ENDPOINTS_PATHSPEC exists so the self-test can narrow the scan. It is not a
 * bypass: narrowing it to nothing makes the gate EXIT 1 (see main).
 */
function listCandidateFiles() {
  const pathspec = parsePathspecOverride(
    process.env.RETIRED_ENDPOINTS_PATHSPEC,
    DEFAULT_PATHSPEC,
  );
  return listTrackedFiles({
    repoRoot: REPO_ROOT,
    pathspec,
    exclude: SELF_REFERENTIAL,
  });
}

function main() {
  if (RETIRED.length === 0) {
    console.error(
      "FAIL: the retired-endpoints table is empty, so this gate checks nothing.",
    );
    console.error(
      "      A gate that cannot fail is not the same as a clean tree. Rows are added on",
      "\n      retirement and never removed.",
    );
    process.exit(1);
  }

  const { files, skippedMissing } = listCandidateFiles();
  // Never silent. A tracked path missing from the working tree is reported whether the gate
  // passes or fails — an unreported skip is how this gate under-scanned 81 files and still
  // said "clean".
  if (skippedMissing.length > 0) {
    console.error(
      `NOTE: ${skippedMissing.length} tracked path(s) are absent from the working tree and were not scanned:`,
    );
    for (const entry of skippedMissing) {
      console.error(`      ${entry}`);
    }
  }
  if (files.length === 0) {
    console.error(
      "FAIL: the retired-endpoints gate scanned ZERO files. A glob that stops matching",
    );
    console.error(
      "      reports a clean tree forever; zero scanned files is a broken gate, not a pass.",
    );
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    const lines = readFileSync(resolve(REPO_ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const entry of RETIRED) {
        if (line.includes(entry.path)) {
          violations.push({
            file,
            line: index + 1,
            entry,
            text: line.trim().slice(0, 160),
          });
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error(
      `FAIL: ${violations.length} reference(s) to a retired endpoint across ${files.length} scanned file(s).`,
    );
    console.error(
      "      A caller of a deleted route fails at runtime as a 404 the UI renders as an",
    );
    console.error(
      "      error state or an empty list — a broken read wearing the face of 'no data'.\n",
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.entry.path}`);
      console.error(`      ${v.text}`);
      console.error(`      retired in: ${v.entry.retiredIn}`);
      console.error(`      use instead: ${v.entry.replacement}\n`);
    }
    process.exit(1);
  }

  console.log(
    `OK: retired endpoints — ${files.length} file(s) scanned, no caller remains for ${RETIRED.length} retired path(s):`,
  );
  for (const entry of RETIRED) {
    console.log(`      ${entry.path}  ->  ${entry.replacement}`);
  }
}

main();
