/**
 * The calendar data layer's public surface. Components import from here, never from the
 * modules directly, so the set of things a component can reach is a deliberate list.
 */
export { calendarKeys } from "./keys";
export {
  useCalendar,
  useGuardianCalendar,
  usePrefetchAdjacentRange,
  useStudyProfile,
} from "./queries";
export {
  newIntent,
  useAcknowledge,
  useDoItNow,
  useEditDay,
  useMoveBlock,
  useRegenerateDay,
  useRegeneratePlan,
  useResetDay,
  useStudyProfileMutation,
  type StudyProfileFields,
} from "./mutations";
export { useLaunchBlock } from "./launch";
// The one profile write, for a surface outside the calendar that saves with the app's global
// query client (onboarding, SCL-223). Same route, same schema as useStudyProfileMutation.
export { putStudyProfile } from "./client";
