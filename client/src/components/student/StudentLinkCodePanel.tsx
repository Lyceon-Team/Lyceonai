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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, Check, RefreshCw, KeyRound } from "lucide-react";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse, toUserFacingMessage } from "@/lib/api-error";
/**
 * Module-specific imports, NOT the `@lyceon/shared` barrel. The barrel re-exports `env.ts`,
 * whose Zod schema names `CSRF_SECRET`; importing it from a client component drags that
 * string into the browser bundle and `check-no-test-routes-dist`'s secret scan fails the
 * build. Caught exactly that way on 2026-09-01.
 */
import {
  studentLinkCodeUrl,
  studentLinkCodeRegenerateUrl,
} from "../../../../packages/shared/src/student-resources";
import {
  studentLinkCodeViewSchema,
  type StudentLinkCodeView,
} from "../../../../packages/shared/src/student-link-code-schema";

export const STUDENT_LINK_CODE_QUERY_KEY = ["student-link-code"] as const;

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
  if (!res.ok) throw await parseApiErrorFromResponse(res, "Could not load your link code");
  const payload = (await res.json()) as { data?: unknown };
  // Parsed, not cast: a renamed field fails here with a named path rather than rendering
  // `undefined` into the one string the student is about to read out loud.
  return studentLinkCodeViewSchema.parse(payload?.data);
}

export function StudentLinkCodePanel({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: STUDENT_LINK_CODE_QUERY_KEY,
    queryFn: () => readCode(studentId),
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch(studentLinkCodeRegenerateUrl(studentId), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw await parseApiErrorFromResponse(res, "Could not regenerate your code");
      const payload = (await res.json()) as { data?: unknown };
      return studentLinkCodeViewSchema.parse(payload?.data);
    },
    onSuccess: (fresh) => {
      setCopied(false);
      queryClient.setQueryData(STUDENT_LINK_CODE_QUERY_KEY, fresh);
    },
  });

  const hours = hoursUntil(data?.expiresAt ?? null, new Date());

  return (
    <Card data-testid="student-link-code-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Your guardian link code
        </CardTitle>
        <CardDescription>
          Share this code with a parent or guardian so they can follow your progress.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading your code...</p>}

        {error && (
          <Alert>
            <AlertDescription data-testid="student-link-code-error">
              {toUserFacingMessage(error).message}
            </AlertDescription>
          </Alert>
        )}

        {data?.code && (
          <>
            <div className="flex items-center gap-3">
              <code
                data-testid="student-link-code-value"
                className="text-2xl font-mono tracking-[0.3em] px-4 py-2 rounded-md bg-muted"
              >
                {data.code}
              </code>
              <Button
                variant="outline"
                size="sm"
                data-testid="student-link-code-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(data.code ?? "");
                  setCopied(true);
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-2">{copied ? "Copied" : "Copy"}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="student-link-code-regenerate"
                disabled={regenerate.isPending}
                onClick={() => regenerate.mutate()}
              >
                <RefreshCw className="h-4 w-4" />
                <span className="ml-2">
                  {regenerate.isPending ? "Regenerating..." : "Regenerate"}
                </span>
              </Button>
            </div>

            {hours !== null && (
              <p className="text-sm text-muted-foreground" data-testid="student-link-code-expiry">
                {hours === 0 ? "Expires shortly" : `Expires in ${hours}h`}
              </p>
            )}

            {/* The consequence, stated where the sharing happens. */}
            <p className="text-sm text-muted-foreground" data-testid="student-link-code-consequence">
              Anyone who enters this code becomes your guardian and can see your progress
              reports. They cannot see your tutor conversations, and you can remove them at
              any time. The code stops working once it has been used.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
