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
 * plain English: the main column is the welcome, the diagnostic card — "Find your blind spots"
 * (only while the student has no baseline: a ruler of their own progress and the start button)
 * — the Practice and Review buttons, and "How Lyceon works" (three steps tagged Free or Paid
 * plans). Final brief v2 (Karl, 2026-10-13): while the Getting started checklist is active it
 * sits above today's question, replaces "How Lyceon works" and owns the one primary (the blind
 * spots button is outlined until it is dismissed); Practice and Review are outlined buttons; the
 * locked full-length card (owner ruling 2026-10-05) is removed from Home. The
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
import type { FeatureLockReason } from "@lyceon/shared/feature-access";
import { AppShellPanel } from "@/components/layout/app-shell";
import { LockedMasteryCard } from "@/components/mastery/LockedMasteryCard";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { Notice, PageHeader } from "@/components/student-ui";
import { useActiveSessions } from "@/hooks/useActiveSessions";
import { useHomeProjection } from "@/hooks/useHomeProjection";
import { usePracticeQuota } from "@/hooks/usePracticeQuota";
import { HomeQotdSection } from "./qotd/HomeQotdSection";
import { HomeStreakChip } from "./qotd/StreakChip";
import { homeQotdFirstLoad, useHomeQotd } from "@/hooks/useHomeQotd";
import { HomeLoading } from "./HomeLoading";
import { ProjectionSection, QuotaSection } from "./HomePanel";
import { DiagnosticCard } from "./DiagnosticCard";
import { GettingStartedCard } from "./GettingStartedCard";
import { HomePracticeReview } from "./HomePracticeReview";
import { useGettingStarted } from "@/hooks/useGettingStarted";
import { BLIND_SPOTS_NAME } from "@/lib/blind-spots-copy";
import {
  diagnosticStepBody,
  freeHomeStage,
  practiceStepBody,
} from "./home-model";

const SECTION_H2 =
  "m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong";

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
      title: BLIND_SPOTS_NAME,
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
  const qotd = useHomeQotd();
  const practice = useActiveSessions();
  const quota = usePracticeQuota();
  const gettingStarted = useGettingStarted();
  const stage = freeHomeStage(projection.estimateStatus);

  const trimmed = name?.trim() ?? "";

  const failed = projection.isError || practice.isError || quota.isError;
  // QA2-F (Karl, 2026-10-08: "Full-Length cards: no layout shift on load"): the stage (the
  // diagnostic card above "How Lyceon works") and the panel come from these reads, so the page
  // is drawn once they have answered or failed (HomeLoading.tsx).
  const settled =
    !projection.isLoading &&
    !practice.isLoading &&
    !quota.isLoading &&
    !gettingStarted.isLoading &&
    // First-run activation brief (Karl, 2026-10-13) P1: the QOTD card lands with the page.
    !homeQotdFirstLoad(qotd);
  if (!settled) return <HomeLoading />;
  // Final brief v2 §4: while the Getting started checklist is active it sits above today's
  // question and replaces "How Lyceon works"; after dismissal the 2026-10-08/09 order returns.
  // A failed read draws the page as after dismissal: nothing on Home waits on the checklist.
  const checklist =
    gettingStarted.data !== undefined && !gettingStarted.data.dismissed
      ? gettingStarted.data
      : null;

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
            ? `Study smarter, score higher. Start with ${BLIND_SPOTS_NAME} so your practice begins in the right place.`
            : "Study smarter, score higher."
        }
        actions={<HomeStreakChip celebrate={celebrate} />}
      />

      {checklist !== null ? (
        <GettingStartedCard
          data={checklist}
          diagnosticTotal={practice.diagnosticTotalQuestions}
        />
      ) : null}

      {/* Owner brief "Question of the Day on Home" (Karl, 2026-10-08/09): the QOTD card and the
          SAT-date card come right after the greeting and the streak chip, before the next step
          (below the Getting started checklist while it is active, final brief v2 §4). */}
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

      {stage === "diagnostic" ? (
        <DiagnosticCard practice={practice} primary={checklist === null} />
      ) : null}

      <HomePracticeReview />

      {checklist === null ? (
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
        </section>
      ) : null}

      {/* Final brief v2 §4 (Karl, 2026-10-13): the full-length card is gone from Home; full-length
          tests stay on their own page and in the calendar. */}

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
