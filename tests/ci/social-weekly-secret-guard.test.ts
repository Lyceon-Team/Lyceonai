/**
 * The Supabase service-role key is read only on main, never by anything a pull request can run;
 * in the worked-example workflow, only by the weekly job's steps on the scheduled run from main.
 *
 * @spec [Karl's step-3 rulings 2026-11-11: "the existing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *       pair … with the main-only/schedule-only guard and CI test you described. No new secrets";
 *       "Only the weekly upload job reads it, and only on the scheduled run from main; no PR job
 *       may reference it"] | @implemented [2026-11-11]
 *
 * plain English: every workflow under .github/workflows is parsed (yaml, already a dependency).
 * Any step that names secrets.SUPABASE_SERVICE_ROLE_KEY (in its env, with, or run), or any job
 * that names it at job level, must be guarded by an `if` (its own or its job's) that requires
 * github.ref == 'refs/heads/main' and an event a pull request cannot raise (push or schedule).
 * In worked-example-daily.yml the guard must be exactly the scheduled run from main, and only
 * the weekly job may hold the key. Presence first: the weekly job's guarded steps are found.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(__dirname, "../..");
const WF = join(ROOT, ".github/workflows");
const SECRET = /secrets\.SUPABASE_SERVICE_ROLE_KEY\b/;
const WEEKLY_FILE = "worked-example-daily.yml";
const SCHEDULE_MAIN =
  "github.event_name == 'schedule' && github.ref == 'refs/heads/main'";

/** A step runs only when its job's `if` AND its own `if` both hold, so each is kept apart. */
type Use = {
  file: string;
  job: string;
  step: string;
  jobIf: string;
  stepIf: string;
};

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : {};
}

/** Every place a workflow reads the key, with the `if` that guards it (step's and job's). */
export function secretUses(file: string, text: string): Use[] {
  const doc = asRecord(parse(text));
  const uses: Use[] = [];
  for (const [job, raw] of Object.entries(asRecord(doc.jobs))) {
    const j = asRecord(raw);
    const jobIf = typeof j.if === "string" ? j.if : "";
    const jobLevel = JSON.stringify({ env: j.env, with: j.with });
    if (SECRET.test(jobLevel))
      uses.push({ file, job, step: "(job env)", jobIf, stepIf: "" });
    const steps = Array.isArray(j.steps) ? j.steps : [];
    steps.forEach((s, k) => {
      const step = asRecord(s);
      const body = JSON.stringify({
        env: step.env,
        with: step.with,
        run: step.run,
      });
      if (!SECRET.test(body)) return;
      const stepIf = typeof step.if === "string" ? step.if : "";
      uses.push({
        file,
        job,
        step: typeof step.name === "string" ? step.name : `#${k}`,
        jobIf,
        stepIf,
      });
    });
  }
  return uses;
}

/** A guard a pull request can never satisfy: main, and a push or a schedule. */
export function prProofGuard(guard: string): boolean {
  return (
    /github\.ref == 'refs\/heads\/main'/.test(guard) &&
    /github\.event_name == '(push|schedule)'/.test(guard) &&
    !/pull_request/.test(
      guard.replace(/github\.event_name != 'pull_request'/g, ""),
    )
  );
}

const files = readdirSync(WF).filter((f) => /\.ya?ml$/.test(f));
const all = files.flatMap((f) =>
  secretUses(f, readFileSync(join(WF, f), "utf8")),
);

describe("the Supabase service-role key (Karl, 2026-11-11)", () => {
  it("the weekly job reads it, in its build and upload steps (presence first)", () => {
    const weekly = all.filter((u) => u.file === WEEKLY_FILE);
    expect(weekly.map((u) => `${u.job}: ${u.step}`)).toEqual([
      "weekly: Build next week",
      "weekly: Upload to social-weekly (signed links, 14 days)",
    ]);
  });

  it("in the worked-example workflow, only on the scheduled run from main, and only in the weekly job", () => {
    for (const u of all.filter((x) => x.file === WEEKLY_FILE)) {
      expect(u.job).toBe("weekly");
      expect(u.stepIf).toBe(SCHEDULE_MAIN);
    }
  });

  it("everywhere, every read is guarded so no pull request can reach it", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const u of all)
      expect(
        prProofGuard(u.stepIf) || prProofGuard(u.jobIf),
        `${u.file} ${u.job} ${u.step}: job "${u.jobIf}", step "${u.stepIf}"`,
      ).toBe(true);
  });

  it("the guard check refuses an unguarded read, a pull-request guard and a non-main guard", () => {
    const wf = (stepIf: string) => `
on: [pull_request, schedule]
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - name: s
        ${stepIf ? `if: ${stepIf}` : ""}
        env:
          K: \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: echo
`;
    const guardOf = (stepIf: string) =>
      secretUses("x.yml", wf(stepIf))[0]?.stepIf ?? "";
    expect(prProofGuard(guardOf(SCHEDULE_MAIN))).toBe(true);
    expect(prProofGuard(guardOf(""))).toBe(false);
    expect(prProofGuard(guardOf("github.event_name == 'pull_request'"))).toBe(
      false,
    );
    expect(prProofGuard(guardOf("github.event_name == 'schedule'"))).toBe(
      false,
    );
    expect(
      prProofGuard(
        guardOf(
          "github.event_name == 'schedule' || github.event_name == 'pull_request'",
        ),
      ),
    ).toBe(false);
  });
});
