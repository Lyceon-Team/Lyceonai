/**
 * The Add-student modal: the guardian enters the student's link code.
 *
 * @spec [SCL-080 (the code is the credential); Guardian_Closure_Plan G4-02 (G-AUD-17, 19, 22);
 *       G1-02 / R10 (a guardian gives a date of birth, once, before a code is spent); Doc-01A
 *       §44 (429 is the rate-limit answer)] | @implemented [2026-09-30]
 *
 * plain English: one form — the code and the Parent / Guardian Terms. The server decides
 * everything: a refusal is shown in the server's own words, with two exceptions it names by
 * STATUS or CODE rather than by message text:
 *   - 429 → the rate-limit copy (the old dashboard matched "Too many" in a message, G-AUD-22);
 *   - 403 GUARDIAN_DATE_OF_BIRTH_REQUIRED → the date-of-birth field appears, is saved through
 *     POST /api/profile/date-of-birth, and the same code is redeemed again.
 * On success the roster is refetched and the guardian lands on the new student's Dashboard.
 *
 * edge cases: the emailed deep link (`/guardian?code=…`) opens this modal prefilled; the code
 * is normalised for display only — the server's parse is the one that decides validity.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { csrfFetch } from "@/lib/csrf";
import { isApiError, parseApiErrorFromResponse } from "@/lib/api-error";
import { GUARDIAN_STUDENTS_QUERY_KEY } from "@/hooks/useGuardianStudents";
import { redeemLinkCodeResponseSchema } from "@lyceon/shared/student-link-code-schema";
import { guardianPaths } from "./paths";

const RATE_LIMIT_COPY =
  "Too many attempts. Please wait 15 minutes before trying again.";
const DATE_OF_BIRTH_REQUIRED = "GUARDIAN_DATE_OF_BIRTH_REQUIRED";

async function redeem(code: string): Promise<string> {
  const res = await csrfFetch("/api/guardian/link/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    // No terms version: the server resolves the current one at write time (SCL-080).
    body: JSON.stringify({ code, acceptParentGuardianTerms: true }),
  });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Could not use that code");
  }
  return redeemLinkCodeResponseSchema.parse(await res.json()).data
    .student_profile_id;
}

async function saveDateOfBirth(dateOfBirth: string): Promise<void> {
  const res = await csrfFetch("/api/profile/date-of-birth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ dateOfBirth }),
  });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(
      res,
      "Could not save your date of birth",
    );
  }
}

function messageFor(error: unknown): string {
  if (isApiError(error) && error.status === 429) return RATE_LIMIT_COPY;
  return error instanceof Error ? error.message : "Could not use that code";
}

export function AddStudentDialog({
  open,
  onOpenChange,
  initialCode = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCode?: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [code, setCode] = useState(initialCode);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [needsDateOfBirth, setNeedsDateOfBirth] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState<string | null>(null);

  const normalised = code.replace(/\s+/g, "").toUpperCase();

  const link = useMutation({
    mutationFn: redeem,
    onSuccess: (studentId) => {
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: GUARDIAN_STUDENTS_QUERY_KEY,
      });
      onOpenChange(false);
      navigate(guardianPaths.dashboard(studentId));
    },
    onError: (err: unknown) => {
      if (isApiError(err) && err.code === DATE_OF_BIRTH_REQUIRED) {
        setNeedsDateOfBirth(true);
      }
      setError(messageFor(err));
    },
  });

  const dob = useMutation({
    mutationFn: saveDateOfBirth,
    onSuccess: () => {
      setNeedsDateOfBirth(false);
      setError(null);
      link.mutate(normalised);
    },
    onError: (err: unknown) => setError(messageFor(err)),
  });

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    if (normalised.length === 0) {
      setError("Enter the code your student gave you");
      return;
    }
    if (!acceptedTerms) {
      setError("Please agree to the Parent / Guardian Terms to link a student");
      return;
    }
    if (needsDateOfBirth) {
      if (dateOfBirth) dob.mutate(dateOfBirth);
      return;
    }
    link.mutate(normalised);
  };

  const pending = link.isPending || dob.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-student-dialog">
        <DialogHeader>
          <DialogTitle>Add a student</DialogTitle>
          <DialogDescription className="text-base">
            Your student finds their 6-character link code on their Profile
            page, under Settings. Codes expire after 24 hours and work once.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-student-code" className="text-base">
              Link code
            </Label>
            <Input
              id="add-student-code"
              data-testid="add-student-code"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={12}
              className="font-mono text-base tracking-[0.2em] uppercase"
            />
          </div>
          {needsDateOfBirth && (
            <div className="flex flex-col gap-2" data-testid="add-student-dob">
              <Label htmlFor="add-student-dob-input" className="text-base">
                Your date of birth
              </Label>
              <p className="text-base text-muted-foreground">
                We need this once before you link a student.
              </p>
              <Input
                id="add-student-dob-input"
                data-testid="add-student-dob-input"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                required
                className="text-base"
              />
            </div>
          )}
          <label className="flex items-start gap-2 text-base">
            <input
              type="checkbox"
              className="mt-1.5"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              data-testid="add-student-terms"
            />
            <span>
              I agree to the{" "}
              <a
                href="/legal/parent-guardian-terms"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                LYCEON Parent / Guardian Terms
              </a>
              .
            </span>
          </label>
          {error !== null && (
            <p
              role="alert"
              className="text-base text-destructive"
              data-testid="add-student-error"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={pending}
            className="min-h-[48px] text-base"
            data-testid="add-student-submit"
          >
            {pending ? "Linking…" : "Link student"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The top bar's "Add student" control: a button that owns its modal. */
export function AddStudentButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        className="min-h-[44px] text-base"
        onClick={() => setOpen(true)}
        data-testid="add-student-open"
      >
        Add student
      </Button>
      <AddStudentDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
