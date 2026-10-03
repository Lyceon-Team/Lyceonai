/**
 * The Bare card: a centered card on --paper.
 *
 * @spec [student-UI register UI-41; DESIGN.md §2 "Bare card" (login, signup, profile completion,
 *        update password, account recovery, the pending-deletion screen, 404, the error screen)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the page's own content goes inside the card; the page no longer draws its own
 * full-screen centering or outer card. It reads no context (no auth, no query client), because
 * the error screen renders it from the app's outermost error boundary, above every provider.
 *
 * No notification bell: these are signed-out or blocking screens (sign-in, recovery, the
 * pending-deletion lock, errors); listed in shells.notification-bell.test.tsx.
 */
import type { ReactNode } from "react";
import type { ThemeLock } from "@/lib/route-shells";

export function BareCard({
  children,
  themeLock = null,
}: {
  children: ReactNode;
  themeLock?: ThemeLock;
}): JSX.Element {
  return (
    <div
      className="lyc flex min-h-[100dvh] items-center justify-center bg-lyc-paper px-4 py-10"
      data-shell="bare"
      data-theme-lock={themeLock ?? undefined}
    >
      <main
        id="main"
        className="w-full max-w-[480px] rounded-lg border border-lyc-rule bg-lyc-sheet p-6 sm:p-8"
      >
        {children}
      </main>
    </div>
  );
}
