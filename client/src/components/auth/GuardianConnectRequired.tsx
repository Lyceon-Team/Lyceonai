/**
 * @spec [Student Terms §under-13; owner ruling 2026-09-16 — "it must be a useful
 *        screen, not a wall"; Coding Standards §11.1, §11.3]
 * @implemented 2026-09-16
 *
 * plain English: what a student under 13 sees until a guardian connects. It says
 * why, hands them their link code with a copy control, lets them send a guardian
 * an email, and tells them where to find both again.
 *
 * THIS IS NOT A CONSENT GATE, and the distinction is the whole reason it looks
 * like this. Every consent gate was removed on 2026-09-16 — no outstanding
 * document withholds anything from anyone. The under-13 condition is different:
 * it is in the Terms and it is the basis of the under-13 position, so it stays.
 *
 * WHAT MAKES IT A SCREEN RATHER THAN A WALL. A wall states a rule and stops. A
 * screen hands over every means of satisfying it: the code is here and copyable
 * rather than described as "in your settings"; the email field is here rather
 * than a step away; and where to find both later is written down, because
 * somebody will close this tab and come back.
 *
 * NO CONTRACT TEXT LIVES HERE. The reason is one plain sentence and a LINK to
 * /legal/student-terms. Restating the rule in our own words would be a second
 * copy of it, which is the defect the whole legal structure removes.
 *
 * trade-offs / edge cases:
 *  - The code can be absent — a profile row that predates link codes, or a
 *    failed generation. The panel says so and points at settings rather than
 *    rendering an empty box that looks broken.
 *  - Copying can fail (no clipboard permission, insecure context). The button
 *    reports it and the code stays selectable, so the manual path always works.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, Copy, Mail, ShieldAlert } from "lucide-react";

export function GuardianConnectRequired({
  studentLinkCode,
  guardianEmail,
  onGuardianEmailChange,
  onSend,
  sending,
  sent,
}: {
  studentLinkCode: string | null;
  guardianEmail: string;
  onGuardianEmailChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  sent: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyCode(): Promise<void> {
    if (!studentLinkCode) return;
    try {
      await navigator.clipboard.writeText(studentLinkCode);
      setCopied(true);
      setCopyError(null);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // browsers. Saying so beats a button that silently does nothing — the
      // code is selectable, so there is always a way through.
      setCopyError(
        "Couldn't copy automatically — select the code and copy it.",
      );
    }
  }

  return (
    <div className="space-y-6" data-testid="guardian-connect-required">
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          Because you&rsquo;re under 13, a parent or guardian needs to connect
          to your account before you can start studying. This is part of the{" "}
          <a
            href="/legal/student-terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Student Terms
          </a>
          .
        </AlertDescription>
      </Alert>

      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-foreground">
          Your connection code
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Give this to your parent or guardian. They enter it on their own
          LYCEON account to connect to yours.
        </p>

        {studentLinkCode ? (
          <div className="mt-3 flex items-center gap-2">
            <code
              className="flex-1 select-all rounded-md bg-muted px-3 py-2 font-mono text-lg tracking-widest"
              data-testid="student-link-code"
            >
              {studentLinkCode}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={copyCode}
              data-testid="copy-link-code"
              aria-label="Copy your connection code"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        ) : (
          <p
            className="mt-3 text-sm text-muted-foreground"
            data-testid="student-link-code-missing"
          >
            Your code isn&rsquo;t ready yet. You can find it any time under
            Settings → Guardian.
          </p>
        )}

        {copyError && (
          <p
            className="mt-2 text-sm text-amber-700"
            data-testid="copy-link-code-error"
          >
            {copyError}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border p-4">
        <Label htmlFor="guardian-email" className="text-sm font-medium">
          Or send them an invitation
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">
          We&rsquo;ll email your parent or guardian a link to connect.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            id="guardian-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="parent@example.com"
            value={guardianEmail}
            onChange={(e) => onGuardianEmailChange(e.target.value)}
            data-testid="input-guardian-email"
            className="sm:flex-1"
          />
          <Button
            type="button"
            onClick={onSend}
            disabled={sending || guardianEmail.trim().length === 0}
            data-testid="send-guardian-invite"
          >
            <Mail className="mr-2 h-4 w-4" />
            {sending ? "Sending…" : sent ? "Send again" : "Send"}
          </Button>
        </div>
        {sent && (
          <p
            className="mt-2 text-sm text-muted-foreground"
            data-testid="guardian-invite-sent"
          >
            Sent. They can also just use the code above.
          </p>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        You can find your code and change this email any time under{" "}
        <span className="font-medium">Settings → Guardian</span>.
      </p>
    </div>
  );
}

export default GuardianConnectRequired;
