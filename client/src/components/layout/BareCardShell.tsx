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
 *
 * UI-59 (2026-10-03): every bare page is on the student tokens, so the card follows the device
 * theme (no light lock). `BareCardHeader` is the card's one heading block, shared by every bare
 * page: the H1 in Source Serif 4 600 at the section size (28px; the 42px page title would crowd
 * a 480px card) and an optional lead line at the 16px body size in --muted. It is a plain block,
 * not a <header>: the Bare card has no header bar (route-shells.test.tsx checks the shell for one).
 */
import type { ReactNode } from "react";
import type { ThemeLock } from "@/lib/route-shells";
import { cn } from "@/lib/utils";
import { usePublishThemeLock } from "./theme-lock";

/**
 * OQ-60 (f) (owner ruling 2026-10-05, accepted as recommended: "leave the global rule; tighten
 * line-height inside the Bare card only"). The app-wide `p { line-height: 1.75 }` (index.css,
 * base layer) loosens every card paragraph that sets no size of its own. Inside the card only,
 * a paragraph takes the student body leading, 1.55 (`text-lyc-body` / `text-lyc-body-lg` in
 * tailwind.config.ts, DESIGN.md §1 body 16–19px). Wrapped in `:where()` so the rule has the
 * specificity of a bare `p`: it beats the base rule (the utilities layer comes later) and loses
 * to any class on the paragraph itself, so a `text-lyc-meta` line keeps its own 1.45.
 */
const BARE_CARD_PROSE_LEADING = "[:where(&)_p]:leading-[1.55]";

export function BareCard({
  children,
  themeLock = null,
}: {
  children: ReactNode;
  themeLock?: ThemeLock;
}): JSX.Element {
  // F-65: portalled overlays take this shell's lock. Without the app-root provider (the error
  // screen renders above every provider) this is a no-op.
  usePublishThemeLock(themeLock);
  return (
    <div
      className="lyc flex min-h-[100dvh] items-center justify-center bg-lyc-paper px-4 py-10"
      data-shell="bare"
      data-theme-lock={themeLock ?? undefined}
    >
      <main
        id="main"
        className={cn(
          "w-full max-w-[480px] rounded-lg border border-lyc-rule bg-lyc-sheet p-6 sm:p-8",
          BARE_CARD_PROSE_LEADING,
        )}
      >
        {children}
      </main>
    </div>
  );
}

export function BareCardHeader({
  title,
  description,
  align = "start",
}: {
  title: ReactNode;
  description?: ReactNode;
  align?: "start" | "center";
}): JSX.Element {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-2",
        align === "center" ? "text-center" : undefined,
      )}
      data-testid="bare-card-header"
    >
      <h1 className="m-0 font-lyc-serif text-lyc-section font-semibold tracking-normal text-lyc-ink-strong">
        {title}
      </h1>
      {description ? (
        <p className="m-0 text-lyc-body text-lyc-muted">{description}</p>
      ) : null}
    </div>
  );
}
