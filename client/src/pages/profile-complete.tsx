import { FormEvent, useEffect, useMemo, useState } from "react";
import { isProfileGateSatisfied } from "@lyceon/shared/profile-completion";
import { resetOnboardingLoopGuard } from "@/lib/onboarding-loop-guard";
import { Redirect, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { FullPageLoader, Notice } from "@/components/student-ui";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  PROFILE_QUERY_KEY,
  useProfileQuery,
  type ProfileRole,
} from "@/hooks/useProfileQuery";
import { resolveOnboardingErrorMessage } from "@/lib/api-error";
import {
  RETURN_PATH_PARAM,
  postAuthDestination,
  returnPathFromSearch,
  returnPathPrefersGuardian,
} from "@lyceon/shared/return-path";
import {
  MARKETING_CONSENT_LABEL,
  marketingOptInEligible,
} from "../../../packages/shared/src/marketing-consent-schema";
import {
  SatDatePicker,
  type SatDateChoice,
} from "@/components/sat-dates/SatDatePicker";
import {
  targetScoreOf,
  TargetScorePicker,
  type TargetScoreChoice,
} from "@/components/sat-dates/TargetScorePicker";
import { notePostAuthDestination } from "@/lib/landing-entry";
import {
  invalidateGettingStarted,
  recordGettingStartedNotSure,
} from "@/hooks/useGettingStarted";
import {
  calendarKeys,
  newIntent,
  putStudyProfile,
} from "@/features/calendar/api";

/**
 * @spec [student-UI register UI-3A, UI-59; DESIGN.md §1, §2 "Bare card" (profile completion);
 *       register §8/§9 on DOB and consent (unchanged)] | @implemented [2026-10-03]
 * plain English: UI-59 draws the page with the student tokens only, inside the Bare card. Copy,
 * test ids, the request and every redirect are unchanged, for students and guardians alike (this
 * one component serves both). "Complete Profile" is the one filled action; the load-error state's
 * Retry is its filled action and "Back To Login" outline. The decorative icons (the heading's
 * person, the button's tick and spinner) are gone: the type carries the hierarchy and motion is
 * limited to LISA (DESIGN.md §1). The role picker keeps the shared Radix Select (its keyboard and
 * listbox roles) in its `lyc` variant (the student field; its list portals onto <body> with its
 * own `.lyc` root). The name and date fields gain `autocomplete` tokens (name, bday).
 */
interface ProfileCompletionResponse {
  success: boolean;
  profile: {
    role: ProfileRole;
  };
  guardianConsentRequired: boolean;
}

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return age;
}

/**
 * @spec [AS-5; AS-3 landing matrix; register UI-03] | @implemented [2026-09-29]
 * plain English: where a completed profile lands. The return path that rode through onboarding
 * (`/profile/complete?next=…`, written by the login page, RequireRole or the OAuth callback) is
 * read from THIS page's query and re-sanitised by the shared module; it wins only when the role
 * may open it — a guardian is never sent to a student page. Otherwise the role default. An
 * unknown role is treated as a student, as before. Read at call time (not captured at mount)
 * so it is always the current URL.
 *
 * G2-04 (merged from `main`): an under-13 student with no active guardian link goes to the
 * linking page ahead of any return path — the server refuses every learning request until a
 * guardian connects, so the return path would only bounce.
 */
function resolvePostCompletionPath(
  role: ProfileRole | undefined,
  guardianLinkRequired: boolean,
): string {
  if (role !== "guardian" && role !== "admin" && guardianLinkRequired) {
    return "/guardian-required";
  }
  const next =
    typeof window !== "undefined"
      ? returnPathFromSearch(window.location.search)
      : null;
  return postAuthDestination({
    role: role ?? "student",
    needsOnboarding: false,
    next,
  });
}

export default function ProfileComplete() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { refreshUser } = useSupabaseAuth();

  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"student" | "guardian">("student");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [satDates, setSatDates] = useState<SatDateChoice>({
    dates: [],
  });
  // Karl, 2026-10-13 on #1230: "Not sure yet" is recorded only when explicitly chosen.
  const [dateNotSureChosen, setDateNotSureChosen] = useState(false);
  const [scoreChoice, setScoreChoice] = useState<TargetScoreChoice>({
    kind: "unset",
  });
  const targetScore = targetScoreOf(scoreChoice);
  const [errorMessage, setErrorMessage] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);

  // @spec [student-ui register UI-14] | @implemented [2026-09-29] | plain English: the one
  // shared profile query; its 401/403 → `{ authenticated: false }` answer is the one this page
  // already redirected on.
  const { data: hydration, isLoading, error, refetch } = useProfileQuery();

  const profile = hydration?.user ?? null;
  const isAuthenticated = hydration?.authenticated !== false && !!profile;

  useEffect(() => {
    if (!profile || isInitialized) {
      return;
    }

    setDisplayName(profile.display_name ?? "");
    // F13 (owner ruling 2026-10-05): arriving from "I'm a parent or guardian" (`next=/guardian`)
    // makes Guardian the default. A default only: the server validates the submitted role.
    const prefersGuardian =
      typeof window !== "undefined" &&
      returnPathPrefersGuardian(
        new URLSearchParams(window.location.search).get(RETURN_PATH_PARAM),
      );
    setRole(
      profile.role === "guardian" || prefersGuardian ? "guardian" : "student",
    );

    // @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P1: "Date of birth
    // starts empty"; Doc-01_V8 §9 / §37.1 (under-13 gating, unchanged)] | @implemented
    // [2026-10-13] | plain English: the date of birth starts EMPTY. It used to default to
    // today − 13 years, which put every student exactly at the threshold and let a student
    // continue without ever entering their own date (the under-13 gate then rested on a
    // default). Now nothing is assumed: submit asks for a date (the existing "Please enter your
    // date of birth" check), the age line, the under-13 notice, the SAT-date question and the
    // marketing box all appear only once a date is entered, as they key on it.

    setIsInitialized(true);
  }, [profile, isInitialized]);

  const age = useMemo(() => calculateAge(dateOfBirth), [dateOfBirth]);
  const isUnder13 = role === "student" && age !== null && age < 13;
  // @spec [plan R26, Q5; owner Step 0 answer 1 (2026-10-05)] | @implemented [2026-10-05] |
  // plain English: the marketing checkbox is shown only to guardians and students 13+ — the
  // shared rule the server and the database also apply. Hidden means not sent at all, so a box
  // ticked before the date of birth changed to under-13 can never be submitted.
  // @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09), "Onboarding order":
  // Name → DOB (under-13 → guardian gate as today) → "When's your SAT?"; SCL-223] |
  // @implemented [2026-10-09] | plain English: students 13+ answer the SAT question here. An
  // under-13 goes to the guardian gate first, as today, and can add dates later in Settings. The
  // dates are saved through the calendar's one profile write (PUT /api/calendar/profile) after
  // the profile itself, and never complete calendar setup. The question never blocks onboarding:
  // no answer is the same as "Not sure yet" (Home then offers the date card).
  const satDatesAsked = role === "student" && age !== null && !isUnder13;
  const marketingOptInOffered =
    (role === "student" || role === "guardian") &&
    marketingOptInEligible(dateOfBirth === "" ? null : dateOfBirth, new Date());

  const completionMutation = useMutation({
    mutationFn: async (): Promise<ProfileCompletionResponse> => {
      const response = await apiRequest("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim(),
          role,
          // G1-02 (R10): guardians give their date of birth too, through the same field.
          dateOfBirth,
          ...(marketingOptInOffered ? { marketingOptIn } : {}),
        }),
      });

      const completed = (await response.json()) as ProfileCompletionResponse;
      // @spec [owner brief "Getting started checklist + onboarding update" (final brief v2,
      // Karl, 2026-10-13) §1] | @implemented [2026-10-13] | plain English: the SAT question
      // also asks for the target score. Both go through the one study-profile write as a
      // goal-only save (never calendar setup). A "Not sure yet" the student CHOSE for either is
      // recorded for the Getting started checklist; a field left untouched records nothing
      // (Karl, 2026-10-13 on #1230), so step 1 stays open until the student answers it.
      if (satDatesAsked) {
        const goal: { target_exam_dates?: string[]; target_score?: number } =
          {};
        if (satDates.dates.length > 0) goal.target_exam_dates = satDates.dates;
        if (targetScore !== null) goal.target_score = targetScore;
        try {
          if (Object.keys(goal).length > 0) {
            await putStudyProfile(newIntent(goal));
            await queryClient.invalidateQueries({
              queryKey: calendarKeys.profile(),
            });
          }
          const notSureDate = dateNotSureChosen && satDates.dates.length === 0;
          const notSureScore = scoreChoice.kind === "not_sure";
          if (notSureDate || notSureScore) {
            await recordGettingStartedNotSure({
              ...(notSureDate ? { test_date: true } : {}),
              ...(notSureScore ? { target_score: true } : {}),
            });
          }
          await invalidateGettingStarted(queryClient);
        } catch {
          // The profile is complete; the date and score are a second, separate save. Tell the
          // student it failed and let them carry on — Settings has the same pickers.
          toast({
            title: "We couldn't save your SAT date and score",
            description: "You can add them any time in Settings.",
          });
        }
      }
      return completed;
    },
    onSuccess: async (result) => {
      setErrorMessage("");
      // A completed profile ends any loop suspicion (hotfix 2026-10-11).
      resetOnboardingLoopGuard();
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });

      toast({
        title: "Profile completed",
        description: result.guardianConsentRequired
          ? "Next, connect a guardian to your account."
          : "Your onboarding is now complete.",
      });
      // G1-02: the session's role must be the one just written BEFORE navigating. The
      // guardian dashboard gates on the auth context's `isGuardian`; without this refresh it
      // still read the pre-completion 'student' and bounced a new guardian to /dashboard.
      await refreshUser();
      const destination = resolvePostCompletionPath(
        result.profile.role,
        result.guardianConsentRequired,
      );
      // Smart landing (Karl, 2026-10-26, ruling A): finishing onboarding into the default Home
      // is a default entry (a student's first window starts here); a `next` is a deep link.
      notePostAuthDestination(
        destination,
        returnPathFromSearch(window.location.search),
      );
      navigate(destination);
    },
    onError: (error: unknown) => {
      // @spec [contracts/auth-standard-flow.contract.md AS-2, AS-3 / §0] | @implemented 2026-06-20
      // plain English: completion errors route through the onboarding chokepoint — server 400/403
      // validation conditions map to curated, actionable copy; everything else (5xx, leaky, unknown)
      // falls back to a generic recoverable message. The raw HttpApiError.message is never shown.
      const message = resolveOnboardingErrorMessage(error, "save");
      setErrorMessage(message);
      toast({
        title: "Profile completion failed",
        description: message,
      });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");

    if (!displayName.trim()) {
      setErrorMessage("Display name is required.");
      return;
    }

    if (!dateOfBirth) {
      setErrorMessage("Please enter your date of birth to continue.");
      return;
    }

    completionMutation.mutate();
  };

  if (!isLoading && !isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (profile?.role === "admin") {
    return <Redirect to={resolvePostCompletionPath("admin", false)} />;
  }

  /**
   * G-NEW-03: an ALREADY-completed profile redirects on render — but not the one this page is
   * completing. `onSuccess` refetches `/api/profile` before `refreshUser()` has updated the
   * session role, so for that interval the refetched profile said "completed guardian" while
   * the auth context still said "student". Redirecting on it sent the new guardian to
   * /guardian as a student; `RequireRole` bounced them to /dashboard, whose widgets called
   * `/api/progress/kpis` and `/projection` (403 `guardian_blocked`, production 2026-09-29).
   * While the completion is in flight or done, the one navigation is `onSuccess`'s, after
   * the refresh.
   */
  const completing =
    completionMutation.isPending || completionMutation.isSuccess;
  // Hotfix 2026-10-11: "already complete" is the one shared rule the server gate uses, so this
  // page never sends someone back to a page the server will refuse them.
  if (
    !completing &&
    profile !== null &&
    profile.requiredProfileComplete !== false &&
    isProfileGateSatisfied({
      isAdmin: false, // an admin already returned above
      role: profile.role,
      profileCompletedAt: profile.profileCompletedAt,
      dateOfBirthKnown: profile.dateOfBirth !== null,
    })
  ) {
    return (
      <Redirect
        to={resolvePostCompletionPath(
          profile.role,
          profile.guardianConsentRequired === true,
        )}
      />
    );
  }

  if (isLoading) {
    // @spec [student-UI register UI-46; audit §6.2 "Full-page spinner"] | @implemented [2026-10-03]
    // The shared FullPageLoader (role="status", named by its label). UI-59: inside the Bare
    // card, so it fills the card (`fill="region"`) and follows the card's theme (no lock).
    return (
      <FullPageLoader fill="region" label="Loading profile completion..." />
    );
  }

  if (error) {
    // Profile-load failures route through the same onboarding chokepoint (load variant) — the raw
    // server/exception string is never rendered.
    const message = resolveOnboardingErrorMessage(error, "load");
    return (
      <div data-testid="profile-complete-load-error">
        <BareCardHeader title="Unable To Load" description={message} />
        <div className="flex flex-col gap-3">
          <Button
            variant="lyc-primary"
            className="w-full"
            onClick={() => refetch()}
          >
            Retry
          </Button>
          <Button
            className="w-full"
            variant="lyc-outline"
            onClick={() => navigate("/login")}
          >
            Back To Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="profile-complete">
      <BareCardHeader
        title="Complete Your Profile"
        description="Finish basic setup to continue into Lyceon."
      />
      <div className="flex flex-col gap-5">
        {errorMessage && (
          <Notice
            tone="danger"
            title={errorMessage}
            data-testid="alert-error"
          />
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label variant="lyc" htmlFor="display-name">
              Display Name
            </Label>
            <Input
              id="display-name"
              variant="lyc"
              data-testid="input-display-name"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              maxLength={120}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label variant="lyc" htmlFor="role-select">
              Role
            </Label>
            <Select
              value={role}
              onValueChange={(value) =>
                setRole(value as "student" | "guardian")
              }
            >
              <SelectTrigger
                id="role-select"
                variant="lyc"
                data-testid="select-role"
              >
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent variant="lyc">
                <SelectItem value="student" variant="lyc">
                  Student
                </SelectItem>
                <SelectItem value="guardian" variant="lyc">
                  Guardian
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label variant="lyc" htmlFor="date-of-birth">
              Date Of Birth
            </Label>
            <Input
              id="date-of-birth"
              variant="lyc"
              data-testid="input-date-of-birth"
              type="date"
              autoComplete="bday"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
              required
            />
            {age !== null && (
              <p className="m-0 text-lyc-meta-lg text-lyc-muted">
                Age detected: {age}
              </p>
            )}
            {isUnder13 && (
              <p
                className="m-0 text-lyc-meta-lg text-lyc-ink"
                data-testid="text-under-13-next-step"
              >
                Under 13: after this step you&apos;ll connect a guardian with
                your link code before you can start practicing.
              </p>
            )}
          </div>

          {satDatesAsked && (
            <SatDatePicker
              value={satDates}
              onChange={(next) => {
                setSatDates(next);
                if (next.dates.length > 0) setDateNotSureChosen(false);
              }}
              onNotSureChosen={() => setDateNotSureChosen(true)}
              data-testid="onboarding-sat-dates"
            />
          )}

          {satDatesAsked && (
            <TargetScorePicker
              value={scoreChoice}
              onChange={setScoreChoice}
              help="You can change this any time in Settings."
              data-testid="onboarding-target-score"
            />
          )}

          {marketingOptInOffered && (
            <div className="flex items-start gap-3">
              <Checkbox
                id="marketing-opt-in"
                variant="lyc"
                className="mt-0.5"
                data-testid="checkbox-marketing-opt-in"
                checked={marketingOptIn}
                onCheckedChange={(checked) =>
                  setMarketingOptIn(Boolean(checked))
                }
              />
              <Label
                htmlFor="marketing-opt-in"
                className="text-lyc-meta-lg font-normal leading-snug text-lyc-ink"
              >
                {MARKETING_CONSENT_LABEL}
              </Label>
            </div>
          )}

          <Button
            type="submit"
            variant="lyc-primary"
            data-testid="button-complete-profile"
            className="w-full"
            disabled={completionMutation.isPending}
          >
            {completionMutation.isPending ? "Saving..." : "Complete Profile"}
          </Button>
        </form>
      </div>
    </div>
  );
}
