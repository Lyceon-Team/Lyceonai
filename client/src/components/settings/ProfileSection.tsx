/**
 * Settings → Profile: the name, and the test date and target once a calendar profile exists.
 *
 * @spec [DESIGN.md §4 Settings "Profile"; prototype Settings.dc.html; student-UI register OQ-28
 *        (narrow name-only save, F-54: `PATCH /api/profile/name`), OQ-20 (owner ruling
 *        2026-10-02: the test date and target show only when a calendar profile exists, else "Set
 *        up your study calendar" linking to the calendar; saved via `PUT /api/calendar/profile`),
 *        OQ-25 (ungated `GET /api/calendar/profile`), OQ-42 (dream schools only from
 *        `/api/profile/background`), UI-S8 / OQ-37 ("About you" hidden until UI-S8 closes);
 *        Coding Standards §4.2 (the profile write carries an idempotency key)]
 *        | @implemented [2026-10-03]
 *
 * plain English: one form, one "Save changes". It sends only what changed: a new name goes to
 * the narrow name route (never `marketingOptIn`), a new test date or target goes to the
 * calendar's own profile route with a fresh idempotency key. Whether the two goal fields appear
 * is decided by the study profile read: `profile: null` (no calendar setup yet) shows the link
 * to the calendar instead, because the calendar route refuses to create a profile from these two
 * fields alone (UI-S2).
 *
 * "ABOUT YOU" IS NOT HERE. Graduation year, GPA range, high school and dream schools wait for
 * UI-S8 (the privacy-policy row) to close; until then this section neither renders them nor reads
 * `/api/profile/background` or `/api/reference/*`.
 *
 * SCL-223 (owner brief "Question of the Day on Home", Karl 2026-10-08/09) | updated [2026-10-09]:
 * the SAT dates are now ALWAYS shown, as the shared multi-date picker, and saved through the same
 * PUT /api/calendar/profile with `target_exam_dates` — a dates-only save creates the row without
 * completing calendar setup. The target score still waits for calendar setup (OQ-20).
 *
 * edge cases: an unchanged form has nothing to save, so the button is disabled; a failed read of
 * the study profile shows the error instead of guessing which state applies; a refusal shows
 * the server's own message.
 */
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type StudyProfile } from "@lyceon/shared/calendar/profile";
import { chicagoToday } from "@shared/sat-test-dates";
import {
  SatDatePicker,
  type SatDateChoice,
} from "@/components/sat-dates/SatDatePicker";
import { TargetScorePicker } from "@/components/sat-dates/TargetScorePicker";
import {
  invalidateGettingStarted,
  recordGettingStartedNotSure,
} from "@/hooks/useGettingStarted";
import { Notice } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  newIntent,
  useStudyProfile,
  useStudyProfileMutation,
  type StudyProfileFields,
} from "@/features/calendar/api";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { toUserFacingMessage } from "@/lib/api-error";
import { saveProfileName, settingsErrorMessage } from "@/lib/settings-api";
import {
  FIELD_HELP,
  FIELD_INPUT,
  FIELD_LABEL,
  SectionHeading,
} from "./settings-ui";

export function ProfileSection({ name }: { name: string }): JSX.Element {
  const studyProfile = useStudyProfile();
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6"
      data-testid="settings-profile"
    >
      <SectionHeading id={headingId}>Profile</SectionHeading>
      {studyProfile.isLoading ? (
        <div
          className="flex flex-col gap-3"
          data-testid="settings-profile-loading"
        >
          <Skeleton variant="lyc" className="h-12 w-full" />
          <Skeleton variant="lyc" className="h-12 w-full" />
        </div>
      ) : studyProfile.isError ? (
        <Notice
          tone="warning"
          title={toUserFacingMessage(studyProfile.error).title}
          message={toUserFacingMessage(studyProfile.error).message}
          data-testid="settings-goal-error"
        />
      ) : (
        <ProfileForm name={name} goal={studyProfile.data?.profile ?? null} />
      )}
    </section>
  );
}

function ProfileForm({
  name,
  goal,
}: {
  name: string;
  goal: StudyProfile | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState(name);
  const today = chicagoToday();
  const savedDates = (goal?.target_exam_dates ?? [])
    .filter((d) => d >= today)
    .sort();
  const [dates, setDates] = useState<SatDateChoice>({
    dates: savedDates,
  });
  // Ruling 1 (Karl, 2026-10-13): the target score is shown to every student, not only after
  // calendar setup; it saves with the dates as a goal-only write (never calendar setup).
  const savedScore = goal?.target_score ?? null;
  const [score, setScore] = useState<number | null>(savedScore);
  const [saved, setSaved] = useState(false);

  const nameSave = useMutation({ mutationFn: saveProfileName });
  const goalSave = useStudyProfileMutation();

  const trimmedName = draftName.trim();
  const nameChanged = trimmedName !== name.trim();
  const goalChange: StudyProfileFields = {};
  if (dates.dates.join(",") !== savedDates.join(",")) {
    goalChange.target_exam_dates = dates.dates;
  }
  if (score !== savedScore) goalChange.target_score = score;
  const goalChanged = Object.keys(goalChange).length > 0;
  const pending = nameSave.isPending || goalSave.isPending;
  const error = nameSave.error ?? goalSave.error;

  // "Not sure yet" for either is recorded for the Getting started checklist (final brief v2
  // §1); the checklist is refreshed after any goal save, since the server decides what is done.
  async function afterGoalSaved(): Promise<void> {
    const notSureDate = dates.dates.length === 0;
    const notSureScore = score === null;
    if (notSureDate || notSureScore) {
      await recordGettingStartedNotSure({
        ...(notSureDate ? { test_date: true } : {}),
        ...(notSureScore ? { target_score: true } : {}),
      });
    }
    await invalidateGettingStarted(queryClient);
    setSaved(true);
  }
  function saveGoal(): void {
    if (!goalChanged) {
      void afterGoalSaved();
      return;
    }
    goalSave.mutate(newIntent(goalChange), {
      onSuccess: () => void afterGoalSaved(),
    });
  }

  function save(): void {
    setSaved(false);
    nameSave.reset();
    goalSave.reset();
    if (!nameChanged) {
      saveGoal();
      return;
    }
    nameSave.mutate(trimmedName, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
        saveGoal();
      },
    });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className={FIELD_LABEL}>
        Name
        <input
          type="text"
          value={draftName}
          maxLength={120}
          autoComplete="name"
          onChange={(event) => {
            setSaved(false);
            setDraftName(event.target.value);
          }}
          className={FIELD_INPUT}
          data-testid="settings-name"
        />
        <span className={FIELD_HELP}>
          Shown on your dashboard and to a guardian you link.
        </span>
      </label>

      <div className="flex flex-col gap-3" data-testid="settings-goal">
        <SatDatePicker
          legend="SAT test date"
          value={dates}
          onChange={(next) => {
            setSaved(false);
            setDates(next);
          }}
          today={today}
          data-testid="settings-test-dates"
        />
        <p className={FIELD_HELP}>
          Pick every date you might take. We use the next one for your countdown
          and study plan.
        </p>
      </div>

      <div className="flex flex-col gap-3" data-testid="settings-target-block">
        <TargetScorePicker
          legend="Target score"
          value={score}
          onChange={(next) => {
            setSaved(false);
            setScore(next);
          }}
          data-testid="settings-target"
        />
        <p className={FIELD_HELP}>
          Your study calendar uses the same test date and target, so changing
          them here updates your plan.
        </p>
      </div>

      {error ? (
        <p
          className="m-0 text-lyc-body text-lyc-danger"
          role="alert"
          data-testid="settings-profile-error"
        >
          {settingsErrorMessage(error)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-[18px] pt-1">
        <Button
          type="submit"
          variant="lyc-primary"
          size="lyc-lg"
          disabled={
            pending || trimmedName.length === 0 || !(nameChanged || goalChanged)
          }
          data-testid="settings-profile-save"
        >
          Save changes
        </Button>
        {saved ? (
          <span
            role="status"
            className="text-lyc-body font-semibold text-lyc-ok"
            data-testid="settings-profile-saved"
          >
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
