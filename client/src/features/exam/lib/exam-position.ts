/**
 * Where a session is — derived from the server's state read, never from the URL.
 *
 * @spec [Doc-04A_V2.2, §5 (session and section states), §7.3, §12 (Module 2 start
 *        after Module 1 submit), §15.1 (state read); SCL-132 (Module 2 is '2')]
 *       [E7b decision log D3 (the URL is a view of the server position)]
 * @implemented [2026-09-25]
 *
 * plain English: the shell asks the server where the student is and routes there. A
 * URL naming any other module — a submitted one typed back in, a future one — is
 * replaced by the server's position, so a submitted module cannot be re-entered by URL
 * (and the server refuses it anyway: 409 module_submitted).
 */
import type {
  ExamModule,
  ExamSection,
  ExamSessionResponse,
} from "@lyceon/shared/exam-runtime-schema";

export type ExamPosition =
  | { kind: "not_started" }
  | { kind: "module"; section: ExamSection; module: ExamModule }
  /** Module 1 submitted, Module 2 not yet started (a reload between the two). */
  | { kind: "module2_ready"; section: ExamSection }
  | { kind: "break" }
  | { kind: "finished" };

export function examPosition(session: ExamSessionResponse): ExamPosition {
  switch (session.state) {
    case "completed":
    case "abandoned_final":
    case "partial_scored_abandoned":
      return { kind: "finished" };
    case "created":
      return { kind: "not_started" };
    case "section_break":
      return { kind: "break" };
    case "active": {
      const section = session.active_section;
      const row = session.sections.find((s) => s.section === section);
      if (section === null || row === undefined) return { kind: "not_started" };
      if (row.state === "module1_active") return { kind: "module", section, module: "1" };
      if (row.state === "module2_active") return { kind: "module", section, module: "2" };
      if (row.state === "module1_submitted") return { kind: "module2_ready", section };
      return { kind: "not_started" };
    }
  }
}

export function sessionPath(sessionId: string): string {
  return `/tests/${sessionId}`;
}

export function modulePath(
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): string {
  return `/tests/${sessionId}/${section}/${module}`;
}

export function reportPath(sessionId: string): string {
  return `/tests/${sessionId}/report`;
}

/** The URL the server position belongs at. */
export function pathForPosition(sessionId: string, position: ExamPosition): string {
  switch (position.kind) {
    case "module":
      return modulePath(sessionId, position.section, position.module);
    case "finished":
      return reportPath(sessionId);
    case "not_started":
    case "module2_ready":
    case "break":
      return sessionPath(sessionId);
  }
}

export type ModuleRoute = { section: ExamSection; module: ExamModule };

/** Parses the two URL segments; anything else is not a module URL. */
export function parseModuleRoute(
  section: string | undefined,
  module: string | undefined,
): ModuleRoute | null {
  if ((section === "RW" || section === "M") && (module === "1" || module === "2")) {
    return { section, module };
  }
  return null;
}

/** True only when the URL names exactly the module the server says is active. */
export function routeMatchesPosition(
  route: ModuleRoute,
  position: ExamPosition,
): boolean {
  return (
    position.kind === "module" &&
    position.section === route.section &&
    position.module === route.module
  );
}
