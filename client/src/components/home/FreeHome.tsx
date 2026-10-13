/**
 * Home for a free student (DESIGN.md §4 Home, "Free").
 *
 * @spec [DESIGN.md §3 (Locked mastery card, Ruler progress), §4 Home; prototype Main.dc.html
 *        (plan = free); evidence/wiring-table.md §3 Home (diagnostic card: practice
 *        `/sessions/open` diagnostic row; start: POST /api/practice/diagnostic/sessions; when to
 *        show the card: `estimateStatus`; quota: GET /api/practice/quota); register §2 (free:
 *        the diagnostic, the projection, the daily practice questions, unlimited review; the
 *        locked mastery card shows empty outlines only), OQ-21, OQ-36, OQ-39(c) (after the
 *        diagnostic: the free layout, the projection in the panel, "Go to practice" primary);
 *        owner ruling Q2 2026-08-17 (a finished diagnostic is never offered again); OQ-68 (d)
 *        (owner ruling, Karl, 2026-10-08, UI-64: the configured numbers in the copy come from
 *        the server)] | @implemented [2026-10-03; OQ-68 (d) 2026-10-08]
 *
 * plain English: the main column is the welcome, the diagnostic card (only while the student
 * has no baseline: a ruler of their own diagnostic's progress and "Start diagnostic", the ONE
 * primary action) and "How Lyceon works" (three steps tagged Free or Paid plans). Once the
 * diagnostic is done the card goes and "Go to practice" becomes the primary (OQ-39(c)). Last in
 * the column is the "Start a full-length test" card (owner ruling, Karl, 2026-10-05), locked
 * here: it opens the upgrade modal in place and reads nothing. The
 * right panel is the projected score (or why there is none yet), the locked mastery card
 * ("See what's included" opens the upgrade modal for `mastery_detail`) and today's quota.
 *
 * NO GATED READS. Nothing here calls a paid route: no calendar, no mastery, no exam forms. The
 * mastery card draws shapes only, and the modal opens in place with no request.
 *
 * NUMBERS IN THE COPY (OQ-68 (d), UI-64). The diagnostic's length and per-domain count are
 * `GET /api/practice/sessions/open`'s `diagnosticTotalQuestions` / `diagnosticPerDomain` (the
 * config `POST /diagnostic/sessions` sizes it with; this page already reads that route for the
 * diagnostic row), and the daily limit is `GET /api/practice/quota`'s `freeDailyLimit` (the
 * 402's `daily_quota_free`). None is written here; a failed read prints the sentence without
 * its number (home-model.ts `diagnosticCardLine`, `diagnosticStepBody`, `practiceStepBody`).
 *
 * edge cases: "N of M answered" is drawn only from an open diagnostic session (the count is
 * the student's own); before one exists the ruler is empty and no count is printed. While
 * `estimateStatus` is unknown neither the card nor a primary is shown, so nothing is offered on
 * a guess.
 */
import { useState } from "react";
import { Link } from "wouter";
import type { FeatureLockReason } from "@lyceon/shared/feature-access";
import { AppShellPanel } from "@/components/layout/app-shell";
import { LockedMasteryCard } from "@/components/mastery/LockedMasteryCard";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { Notice, PageHeader } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { useActiveSessions } from "@/hooks/useActiveSessions";
import { useHomeProjection } from "@/hooks/useHomeProjection";
import { usePracticeQuota } from "@/hooks/usePracticeQuota";
import { FullLengthCard } from "./FullLengthCard";
import { HomeQotdSection } from "./qotd/HomeQotdSection";
import { HomeStreakChip } from "./qotd/StreakChip";
import { HomeLoading } from "./HomeLoading";
import { ProjectionSection, QuotaSection } from "./HomePanel";
import { DiagnosticCard } from "./DiagnosticCard";
import {
  diagnosticStepBody,
  freeHomeStage,
  practiceStepBody,
} from "./home-model";

const SECTION_H2 =
  "m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong";
const TEXT_LINK =
  "text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";

const FREE_TAG = "border border-lyc-lv2-bd bg-lyc-lv2-bg text-lyc-lv2-ink";
const PAID_TAG = "bg-lyc-primary-bg text-lyc-primary-ink";

/**
 * The prototype's three steps (approved copy), with the server's numbers where the prototype
 * wrote "Forty" (OQ-68 (d)): the diagnostic's length and the free daily limit.
 */
function howSteps(
  diagnosticTotal: number | null,
  freeDailyLimit: number | null,
): readonly {
  n: string;
  title: string;
  body: string;
  tag: string;
  tone: string;
}[] {
  return [
    {
      n: "1",
      title: "Take the diagnostic",
      body: diagnosticStepBody(diagnosticTotal),
      tag: "Free",
      tone: FREE_TAG,
    },
    {
      n: "2",
      title: "Practice and review every day",
      body: practiceStepBody(freeDailyLimit),
      tag: "Free",
      tone: FREE_TAG,
    },
    {
      n: "3",
      title: "Follow a plan and track mastery",
      body: "A study calendar, mastery for every domain and skill, full-length tests and LISA, your tutor.",
      tag: "Paid plans",
      tone: PAID_TAG,
    },
  ];
}

type FreeHomeProps = {
  studentId: string;
  name: string | null;
  /** Why mastery is locked (plan or age); the modal says the matching thing. */
  masteryLock: FeatureLockReason;
};

export function FreeHome({
  studentId,
  name,
  masteryLock,
}: FreeHomeProps): JSX.Element {
  const upgrade = useUpgradeModal();
  // The streak chip zooms once when this visit's QOTD answer extended the streak.
  const [celebrate, setCelebrate] = useState(false);
  const projection = useHomeProjection(studentId);
  const practice = useActiveSessions();
  const quota = usePracticeQuota();
  const stage = freeHomeStage(projection.estimateStatus);

  const trimmed = name?.trim() ?? "";

  const failed = projection.isError || practice.isError || quota.isError;
  // QA2-F (Karl, 2026-10-08: "Full-Length cards: no layout shift on load"): the stage (the
  // diagnostic card above "How Lyceon works") and the panel come from these reads, so the page
  // is drawn once they have answered or failed (HomeLoading.tsx).
  const settled =
    !projection.isLoading && !practice.isLoading && !quota.isLoading;
  if (!settled) return <HomeLoading />;

  const freeDailyLimit = quota.data?.freeDailyLimit ?? null;

  return (
    <div className="flex flex-col gap-12" data-testid="home" data-plan="free">
      <PageHeader
        title={
          trimmed.length > 0
            ? `Welcome to Lyceon, ${trimmed}`
            : "Welcome to Lyceon"
        }
        description={
          stage === "diagnostic"
            ? "Study smarter, score higher. Start with the free diagnostic so your practice begins in the right place."
            : "Study smarter, score higher."
        }
        actions={<HomeStreakChip celebrate={celebrate} />}
      />

      {/* Owner brief "Question of the Day on Home" (Karl, 2026-10-08/09): the QOTD card and the
          SAT-date card come right after the greeting and the streak chip, before the next step. */}
      <HomeQotdSection onStreakExtended={() => setCelebrate(true)} />

      {failed ? (
        <Notice
          title="We couldn’t load part of your dashboard."
          message="Try again. If this keeps happening, refresh the page."
          actionLabel="Try again"
          onAction={() => {
            projection.refetch();
            void practice.refetch();
            void quota.refetch();
          }}
          data-testid="home-load-error"
        />
      ) : null}

      {stage === "diagnostic" ? <DiagnosticCard practice={practice} /> : null}

      <section
        aria-labelledby="home-how-h"
        className="flex flex-col gap-[18px]"
        data-testid="home-how"
      >
        <h2 id="home-how-h" className={SECTION_H2}>
          How Lyceon works
        </h2>
        <ol className="m-0 list-none border-t border-lyc-rule p-0">
          {howSteps(practice.diagnosticTotalQuestions, freeDailyLimit).map(
            (step) => (
              <li
                key={step.n}
                className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-4 gap-y-3 border-b border-lyc-rule py-[22px] sm:grid-cols-[56px_minmax(0,1fr)_160px] sm:gap-5"
              >
                <span
                  aria-hidden="true"
                  className="font-lyc-serif text-[34px] font-semibold leading-none text-lyc-step"
                >
                  {step.n}
                </span>
                <div className="flex flex-col gap-1.5">
                  <span className="font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong">
                    {step.title}
                  </span>
                  <span className="text-[17px] leading-normal text-lyc-muted">
                    {step.body}
                  </span>
                </div>
                <span
                  className={`col-start-2 justify-self-start whitespace-nowrap rounded-full px-3 py-1 text-lyc-meta-lg font-semibold sm:col-start-auto sm:justify-self-end ${step.tone}`}
                >
                  {step.tag}
                </span>
              </li>
            ),
          )}
        </ol>
        <div className="flex flex-wrap items-center gap-6">
          {stage === "after" || stage === "pending" ? (
            <Button asChild variant="lyc-primary" size="lyc-lg">
              <Link href="/practice" data-testid="home-go-practice">
                Go to practice
              </Link>
            </Button>
          ) : (
            <Link
              href="/practice"
              className={TEXT_LINK}
              data-testid="home-go-practice"
            >
              Go to practice
            </Link>
          )}
          <Link href="/review" className={TEXT_LINK}>
            Go to review
          </Link>
        </div>
      </section>

      {/* Owner ruling (Karl, 2026-10-05) item 4: the full-length card, locked on the free plan
          (it opens the upgrade modal in place). Last in the column, after the free flow. */}
      <FullLengthCard />

      <AppShellPanel>
        <div className="flex flex-col gap-10" data-testid="home-panel">
          <ProjectionSection
            range={projection.range}
            stage={stage}
            targetScore={null}
          />
          <LockedMasteryCard
            onSeeWhatsIncluded={() =>
              upgrade.open("mastery_detail", masteryLock)
            }
          />
          {quota.data !== undefined ? (
            <QuotaSection quota={quota.data} />
          ) : null}
        </div>
      </AppShellPanel>
    </div>
  );
}
