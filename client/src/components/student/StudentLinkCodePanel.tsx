/**
 * The student's link code — display, copy, and regenerate.
 *
 * @spec [SCL-080 — the code replaces §36.1's two email-addressed initiation paths;
 *        Doc 01 V8 §35 Guardian-student linkage] | @implemented [2026-09-01]
 *
 * plain English: shows the six characters a student reads out to a guardian, when they
 * expire, and a control to invalidate them. Expected outcome: a student can hand someone
 * access to their progress without either party sending an email or clicking a link.
 *
 * WHY THE CONSEQUENCE LINE IS NOT OPTIONAL. Sharing this code IS the consent (SCL-080) —
 * there is no later screen where the student confirms. A credential whose effect is not
 * stated at the moment of sharing is not informed consent, so the sentence naming what a
 * guardian gets sits next to the code, not behind a link.
 *
 * Trade-off: `expiresAt` is computed and sent by the server, never derived here from a TTL
 * the client holds, so the countdown cannot disagree with the expiry the server enforces.
 * Edge case: a student who has never had a code gets one issued by the GET itself, so this
 * panel has no empty state to design around.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf";
import {
  parseApiErrorFromResponse,
  toUserFacingMessage,
} from "@/lib/api-error";
/**
 * Module-specific imports, NOT the `@lyceon/shared` barrel. The barrel re-exports `env.ts`,
 * whose Zod schema names `CSRF_SECRET`; importing it from a client component drags that
 * string into the browser bundle and `check-no-test-routes-dist`'s secret scan fails the
 * build. Caught exactly that way on 2026-09-01.
 */
import {
  studentLinkCodeUrl,
  studentLinkCodeRegenerateUrl,
  studentLinkCodeInviteUrl,
} from "../../../../packages/shared/src/student-resources";
import {
  studentLinkCodeViewSchema,
  inviteGuardianRequestSchema,
  type StudentLinkCodeView,
} from "../../../../packages/shared/src/student-link-code-schema";

export const STUDENT_LINK_CODE_QUERY_KEY = ["student-link-code"] as const;
/**
 * G-NEW-11: one cache entry per student. Without the id in the key, an entry cached for one
 * student is served to whichever student mounts the panel next in the same tab.
 */
export function studentLinkCodeQueryKey(studentId: string) {
  return [...STUDENT_LINK_CODE_QUERY_KEY, studentId] as const;
}

/** Hours remaining, floored, or null when there is no expiry to report. */
function hoursUntil(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 3_600_000);
}

async function readCode(studentId: string): Promise<StudentLinkCodeView> {
  const res = await csrfFetch(studentLinkCodeUrl(studentId), {
    credentials: "include",
  });
  if (!res.ok)
    throw await parseApiErrorFromResponse(res, "Could not load your link code");
  const payload = (await res.json()) as { data?: unknown };
  // Parsed, not cast: a renamed field fails here with a named path rather than rendering
  // `undefined` into the one string the student is about to read out loud.
  return studentLinkCodeViewSchema.parse(payload?.data);
}

export function StudentLinkCodePanel({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: studentLinkCodeQueryKey(studentId),
    queryFn: () => readCode(studentId),
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch(studentLinkCodeRegenerateUrl(studentId), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok)
        throw await parseApiErrorFromResponse(
          res,
          "Could not regenerate your code",
        );
      const payload = (await res.json()) as { data?: unknown };
      return studentLinkCodeViewSchema.parse(payload?.data);
    },
    onSuccess: (fresh) => {
      setCopied(false);
      queryClient.setQueryData(studentLinkCodeQueryKey(studentId), fresh);
    },
  });

  const hours = hoursUntil(data?.expiresAt ?? null, new Date());

  // Guardian invite by email (2026-09-15). An ADDITION to the code, never a replacement: the
  // code stays on screen so the verbal path keeps working. The server never says whether the
  // address has an account, so neither does this — "sent" is all it can honestly report.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const inviteParse = inviteGuardianRequestSchema.safeParse({
    email: inviteEmail,
  });
  const invite = useMutation({
    mutationFn: async (email: string) => {
      const res = await csrfFetch(studentLinkCodeInviteUrl(studentId), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok)
        throw await parseApiErrorFromResponse(res, "Could not send the invite");
    },
    onSuccess: () => {
      setInviteSent(true);
      setInviteEmail("");
    },
  });

  // UI-58 (2026-10-03): drawn with the student tokens (Settings → Guardian; the Bare card on
  // /guardian-required), labels from Settings.dc.html ("Your link code", "Copy code", "Get a new
  // code", "Email it to my guardian"). Requests, test ids and the consequence line unchanged.
  return (
    <div
      className="flex flex-col gap-3.5 text-lyc-ink"
      data-testid="student-link-code-panel"
    >
      <span className="text-[17px] font-semibold text-lyc-ink">
        Your link code
      </span>

      {isLoading && (
        <p className="m-0 text-lyc-body text-lyc-muted">Loading your code...</p>
      )}

      {error && (
        <p
          className="m-0 text-lyc-body text-lyc-danger"
          role="alert"
          data-testid="student-link-code-error"
        >
          {toUserFacingMessage(error).message}
        </p>
      )}

      {data?.code && (
        <>
          <code
            data-testid="student-link-code-value"
            className="self-start rounded-lg border border-dashed border-lyc-rule-strong bg-lyc-sheet px-[22px] py-3.5 font-mono text-[30px] tracking-[0.14em] text-lyc-ink-strong"
          >
            {data.code}
          </code>
          <p className="m-0 text-lyc-meta-lg text-lyc-muted">
            Give this code to your guardian. They enter it in their own Lyceon
            guardian account.
          </p>

          {hours !== null && (
            <p
              className="m-0 text-lyc-meta-lg text-lyc-muted"
              data-testid="student-link-code-expiry"
            >
              {hours === 0 ? "Expires shortly" : `Expires in ${hours}h`}
            </p>
          )}

          {/* The consequence, stated where the sharing happens. */}
          <p
            className="m-0 text-lyc-body text-lyc-ink"
            data-testid="student-link-code-consequence"
          >
            Anyone who enters this code becomes your guardian and can see your
            progress reports. They cannot see your tutor conversations, and you
            can remove them at any time. The code stops working once it has been
            used.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="lyc-outline"
              data-testid="student-link-code-copy"
              onClick={() => {
                void navigator.clipboard?.writeText(data.code ?? "");
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy code"}
            </Button>
            <Button
              type="button"
              variant="lyc-link"
              className="px-3"
              data-testid="student-link-code-regenerate"
              disabled={regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              {regenerate.isPending ? "Regenerating..." : "Get a new code"}
            </Button>
          </div>

          <form
            className="flex flex-col gap-2 border-t border-lyc-rule pt-4"
            data-testid="student-link-invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              setInviteSent(false);
              if (inviteParse.success) invite.mutate(inviteParse.data.email);
            }}
          >
            <label
              htmlFor="student-link-invite-email"
              className="text-[17px] font-semibold text-lyc-ink"
            >
              Or send this code by email
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="student-link-invite-email"
                data-testid="student-link-invite-email"
                type="email"
                autoComplete="off"
                placeholder="guardian@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className={`${LYC_FOCUS} h-11 min-w-0 flex-1 rounded-md border border-lyc-input-bd bg-lyc-sheet px-3.5 text-[17px] text-lyc-ink placeholder:text-lyc-muted`}
              />
              <Button
                type="submit"
                variant="lyc-outline"
                data-testid="student-link-invite-submit"
                disabled={!inviteParse.success || invite.isPending}
              >
                {invite.isPending ? "Sending..." : "Email it to my guardian"}
              </Button>
            </div>
            <p className="m-0 text-lyc-meta-lg text-lyc-muted">
              They will get this code and a link to enter it. They still have to
              sign in to Lyceon before anything is shared.
            </p>
            {inviteSent && (
              <p
                className="m-0 text-lyc-body text-lyc-ink"
                role="status"
                data-testid="student-link-invite-sent"
              >
                Invite sent. It carries this code and expires with it.
              </p>
            )}
            {invite.error && (
              <p
                className="m-0 text-lyc-body text-lyc-danger"
                role="alert"
                data-testid="student-link-invite-error"
              >
                {toUserFacingMessage(invite.error).message}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}
