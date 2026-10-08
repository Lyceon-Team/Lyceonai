/**
 * @spec [student-UI register UI-41 ("every student route renders inside exactly one of the three
 *        shells"); DESIGN.md §2] | @implemented [2026-10-03]
 *
 * plain English: the one place a student route meets its shell. App.tsx wraps each student page
 * in `<StudentRouteFrame route="…">` with the route's own path; the frame looks the path up in
 * `STUDENT_ROUTE_SHELLS` and renders exactly that shell around the page.
 *
 * Shared routes: `/profile` and `/notifications` also admit a guardian, whose page renders its
 * own `GuardianShell`. The App shell is the student's chrome, so for a guardian viewer the frame
 * renders the page alone; the bare routes (update password, profile completion) wrap every role.
 * A display choice only: the route guard and the server decide access.
 *
 * @spec [production QA 2026-10-07 item 5 (Karl: route-level lazy loading with page skeletons
 *        "inside the page's own shell")] | @implemented [2026-10-07]
 * Every page is a lazy chunk. The frame puts the page's Suspense boundary INSIDE the shell, so
 * while a page's chunk loads the real shell stays on screen (the rail with its current item, the
 * bars, the theme) and only the content area shows the page skeleton (RouteSkeleton.tsx), where
 * it used to fall through to the router's full-page loader. A page laid out edge to edge
 * (Calendar, LISA) and a Focus page get the reading column's padding around the skeleton.
 */
import { Suspense, type ReactNode } from "react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  STUDENT_ROUTE_SHELLS,
  type ShellSpec,
  type StudentShellRoute,
} from "@/lib/route-shells";
import { AppShell } from "./app-shell";
import { BareCard } from "./BareCardShell";
import { FocusShell } from "./FocusShell";
import { PageSkeleton } from "./RouteSkeleton";

export function StudentRouteFrame({
  route,
  children,
}: {
  route: StudentShellRoute;
  children: ReactNode;
}): JSX.Element {
  const { user } = useSupabaseAuth();
  const spec: ShellSpec = STUDENT_ROUTE_SHELLS[route];
  switch (spec.shell) {
    case "app":
      if (user?.role === "guardian") return <>{children}</>;
      return (
        <AppShell
          panel={spec.panel}
          footer={spec.footer}
          content={spec.content}
          themeLock={spec.themeLock}
        >
          <Suspense
            fallback={<PageSkeleton padded={spec.content === "full"} />}
          >
            {children}
          </Suspense>
        </AppShell>
      );
    case "focus":
      return (
        <FocusShell
          section={spec.section}
          sectionHome={spec.sectionHome}
          back={spec.back}
          themeLock={spec.themeLock}
        >
          <Suspense fallback={<PageSkeleton padded />}>{children}</Suspense>
        </FocusShell>
      );
    case "bare":
      return (
        <BareCard themeLock={spec.themeLock}>
          <Suspense fallback={<PageSkeleton card />}>{children}</Suspense>
        </BareCard>
      );
  }
}
