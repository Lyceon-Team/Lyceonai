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
 *   - a different retired path written into a file one row exempts → EXIT 1. A row's
 *     `historicalRecords` exempt a file from THAT row only (added 2026-10-05, OQ-61 (a)).
 *   - a row exempting a file that is not in the scan → EXIT 1, names the stale entry.
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
      "GET /api/students/:studentId/tests — G1 (SCL-181, owner ruling 2026-09-27) brought guardian exam results back inside scope on the subject resolver. It lists one student's forms, latest attempt each; Doc 04C §12.4's multi-STUDENT aggregation is still not served",
  },
  {
    path: "/api/guardian/students/:studentId/tests/:sessionId/report",
    retiredIn: "delete-and-ship (outside the four-item guardian scope)",
    replacement:
      "GET /api/students/:studentId/tests/:sessionId/report — G1 (SCL-181): the same resource on the subject resolver, 404/402 instead of 04C §12.1's 403/200",
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
  // --- Student UI follow-ups (owner ruling 2026-10-05, OQ-61 (a)) -----------
  {
    path: "/api/me/streak",
    retiredIn:
      "OQ-61 (a), SCL-212 (owner ruling 2026-10-05 — no student page and not the guardian calendar called it)",
    replacement:
      "the `streak` field of GET /api/calendar (student) or GET /api/students/:studentId/calendar (guardian), or `currentStreakDays` of GET /api/students/:studentId/kpi/overall — all read through server/services/activity-streak.ts",
    // FROZEN RECORDS OF THIS ONE PATH, exempt for this row ONLY (see `historicalRecords`
    // below). Each is a dated audit, a captured measurement, a closure log or a question as
    // it was asked; each names the route as it stood on its date, and rewriting them to
    // satisfy this gate would falsify the record. They stay scanned for every other row.
    historicalRecords: [
      // The OQ-61 question itself (register §9), verbatim as asked; the register is the lead's.
      "docs/plans/student-ui/student-ui-vertical.md",
      // The deletion proof for this retirement — its whole purpose is naming the path.
      "docs/plans/student-ui/evidence/wave5/deletions.md",
      // Dated student-UI audits (2026-09/10): a census of the routes as they were.
      "docs/plans/student-ui/audit/pass1-A.md",
      "docs/plans/student-ui/audit/pass1-B.md",
      "docs/plans/student-ui/audit/pass2-A.md",
      "docs/plans/student-ui/audit/pass2-B.md",
      "docs/plans/student-ui/audit/student-ui-surface-audit.md",
      // Captured Lighthouse runs and the baseline that reports them: the network log of a
      // real page load on the day it was taken.
      "docs/plans/student-ui/evidence/wave0/wave0-baseline.md",
      "docs/plans/student-ui/evidence/wave0/lighthouse/practice-run1.json",
      "docs/plans/student-ui/evidence/wave0/lighthouse/practice-run2.json",
      "docs/plans/student-ui/evidence/wave0/lighthouse/practice-run3.json",
      "docs/plans/student-ui/evidence/track-a-prod/lighthouse/practice-run1.json",
      "docs/plans/student-ui/evidence/track-a-prod/lighthouse/practice-run2.json",
      "docs/plans/student-ui/evidence/track-a-prod/lighthouse/practice-run3.json",
      // Closed work logs: G-NEW-16's closure row and the Doc 05F Brief 3 plant table.
      "docs/plans/Guardian_Closure_Plan.md",
      "docs/plans/Doc_05F_Change_Record_Addendum.md",
    ],
  },
];

/**
 * PER-ROW EXEMPTIONS, NOT GLOBAL ONES. `SELF_REFERENTIAL` below removes a file from the scan
 * for EVERY retired path, so each addition to it is a blind spot for all of them. A row's
 * `historicalRecords` exempts a file only from THAT row's path: the file stays scanned for
 * every other retired path, and a new row starts with no exemptions at all. A path listed
 * there must be tracked — an exemption for a file that no longer exists is stale, and is
 * refused rather than carried (see main).
 */
function isExempt(entry, file) {
  return (entry.historicalRecords ?? []).includes(file);
}

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
  // Added 2026-10-01 (guardian closeout). Same test: the dead-code inventory exists to RECORD
  // deletions, and its evidence is the verbatim output of commands run before them, frozen
  // at commit 5ba57c2 — a retired path appears in it only as quoted grep output. Editing that
  // output to satisfy this gate would falsify the evidence.
  "docs/plans/guardian-dead-code-inventory.md",
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

  // A per-row exemption naming a file that is not in the scan is stale: refused, not carried.
  const scanned = new Set(files);
  const stale = RETIRED.flatMap((entry) =>
    (entry.historicalRecords ?? [])
      .filter((file) => !scanned.has(file))
      .map((file) => `${entry.path}: ${file}`),
  );
  if (stale.length > 0) {
    console.error(
      "FAIL: a retired row exempts a file that is not in the scan. A stale exemption hides",
    );
    console.error("      nothing today and anything tomorrow; remove it:");
    for (const s of stale) console.error(`      ${s}`);
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    const lines = readFileSync(resolve(REPO_ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const entry of RETIRED) {
        if (line.includes(entry.path) && !isExempt(entry, file)) {
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
