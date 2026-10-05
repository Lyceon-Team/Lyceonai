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
 * edge cases: an unchanged form has nothing to save, so the button is disabled; a failed read of
 * the study profile shows the error instead of guessing which state applies; a refusal shows
 * the server's own message.
 */
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { TARGET_SCORE_BOUNDS } from "@lyceon/shared/calendar/profile";
import type { StudyProfile } from "@lyceon/shared/calendar/profile";
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

const CALENDAR_PATH = "/calendar";

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
  const [date, setDate] = useState(goal?.target_exam_date ?? "");
  const [score, setScore] = useState(
    goal?.target_score === null || goal?.target_score === undefined
      ? ""
      : String(goal.target_score),
  );
  const [saved, setSaved] = useState(false);

  const nameSave = useMutation({ mutationFn: saveProfileName });
  const goalSave = useStudyProfileMutation();

  const trimmedName = draftName.trim();
  const nameChanged = trimmedName !== name.trim();
  const goalChange: StudyProfileFields = {};
  if (goal !== null) {
    const nextDate = date === "" ? null : date;
    const nextScore = score === "" ? null : Number(score);
    if (nextDate !== goal.target_exam_date)
      goalChange.target_exam_date = nextDate;
    if (nextScore !== goal.target_score) goalChange.target_score = nextScore;
  }
  const goalChanged = Object.keys(goalChange).length > 0;
  const pending = nameSave.isPending || goalSave.isPending;
  const error = nameSave.error ?? goalSave.error;

  function saveGoal(): void {
    if (!goalChanged) {
      setSaved(true);
      return;
    }
    goalSave.mutate(newIntent(goalChange), { onSuccess: () => setSaved(true) });
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

      {goal === null ? (
        <p
          className="m-0 text-lyc-body text-lyc-ink"
          data-testid="settings-goal-setup"
        >
          <Link
            href={CALENDAR_PATH}
            className="font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline"
          >
            Set up your study calendar
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="settings-goal">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label className={FIELD_LABEL}>
              Test date
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setSaved(false);
                  setDate(event.target.value);
                }}
                className={FIELD_INPUT}
                data-testid="settings-test-date"
              />
            </label>
            <label className={FIELD_LABEL}>
              Target score
              <input
                type="number"
                inputMode="numeric"
                min={TARGET_SCORE_BOUNDS.min}
                max={TARGET_SCORE_BOUNDS.max}
                step={TARGET_SCORE_BOUNDS.step}
                value={score}
                onChange={(event) => {
                  setSaved(false);
                  setScore(event.target.value);
                }}
                className={FIELD_INPUT}
                data-testid="settings-target"
              />
            </label>
          </div>
          <p className={FIELD_HELP}>
            Your study calendar uses the same test date and target, so changing
            them here updates your plan.
          </p>
        </div>
      )}

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
