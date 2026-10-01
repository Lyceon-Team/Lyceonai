/**
 * What a guardian will see once they link a student — the Dashboard's panels, no data.
 *
 * @spec [owner ruling 2026-09-03, option 1 (STRUCTURAL, NOT SAMPLE); owner decision 2026-10-01
 *       on PR 1003 ("Move the 2026-09-03 template preview into the no-students state");
 *       Guardian_Closure_Plan G4-03 (the Dashboard's panels); CLAUDE.md mastery invariant
 *       ("earned from observed events only — never infer, estimate, or invent")]
 *   | @implemented [2026-10-01]
 *
 * plain English: under "Add your first student", the panels the Dashboard will show — this
 * week (streak, projected score, target, test date), mastery by domain for each section, and
 * the latest full-length test — with every figure replaced by a lock, below a line saying
 * what it is. A guardian with no student sees the shape of what linking unlocks instead of an
 * empty page.
 *
 * STRUCTURAL, NOT SAMPLE (owner ruling 2026-09-03). Plausible sample values were refused: a
 * number inside the real dashboard chrome is one CSS regression from reading as a real
 * child's real progress, and no banner survives that. THERE IS NO NUMERAL IN THIS COMPONENT,
 * and `shell-banner-and-preview.test.tsx` asserts the absence over the rendered preview.
 *
 * MOVED, AND REDRAWN FOR THE DASHBOARD IT PREVIEWS. The 2026-09-03 preview drew the retired
 * single-page dashboard's panels (a streak tile, a flat domain list). That dashboard is gone,
 * so this draws the Wave 4 Dashboard's: the domains come from `CANONICAL_DOMAINS_BY_SECTION`
 * grouped by section exactly as `DomainGrid` groups them (the old list's hand-typed
 * "Problem-Solving" was not the canonical name), and the section names from the exam report's
 * labels. A lock is not a level, so the rows are drawn here rather than through `DomainGrid`,
 * whose every card names a real level.
 */
import { Eye, Lock } from "lucide-react";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import { CANONICAL_DOMAINS_BY_SECTION } from "@shared/canonical-domains";

/** The Dashboard's section order (`GuardianDashboardTab`): Reading & Writing, then Math. */
const SECTIONS = ["RW", "M"] as const;
const WEEK_FACTS = [
  "Streak",
  "Projected score",
  "Target",
  "Test date",
] as const;

function Locked({ label }: { label: string }): JSX.Element {
  return (
    <Lock
      className="h-5 w-5 shrink-0 text-muted-foreground"
      aria-label={`${label} — locked`}
    />
  );
}

export function GuardianTemplatePreview(): JSX.Element {
  return (
    <div
      className="flex flex-col gap-5 text-left"
      data-testid="guardian-template-preview"
    >
      <p className="m-0 flex items-start gap-2 rounded-xl border border-border bg-brand-navy/5 p-4 text-base">
        <Eye className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">
            This is what you&rsquo;ll see once you link a student.
          </span>{" "}
          Nothing below is real data — it stays locked until a student shares
          their code with you.
        </span>
      </p>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 opacity-90">
        <h2 className="m-0 text-lg font-semibold">This week</h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
          {WEEK_FACTS.map((fact) => (
            <li
              key={fact}
              className="flex flex-col items-center gap-2 rounded-lg bg-brand-cream p-3 text-center"
            >
              <Locked label={fact} />
              <span className="text-base text-muted-foreground">{fact}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 opacity-90">
        <h2 className="m-0 text-lg font-semibold">Mastery by domain</h2>
        {SECTIONS.map((section) => (
          <div key={section} className="flex flex-col gap-2">
            <h3 className="m-0 text-base font-semibold text-muted-foreground">
              {EXAM_SECTION_LABEL[section]}
            </h3>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
              {CANONICAL_DOMAINS_BY_SECTION[section].map((domain) => (
                <li
                  key={domain}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/35 p-3"
                >
                  <span className="text-base font-medium">{domain}</span>
                  <Locked label={domain} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 opacity-90">
        <h2 className="m-0 text-lg font-semibold">Latest full-length test</h2>
        <Locked label="Latest full-length test" />
      </section>
    </div>
  );
}
