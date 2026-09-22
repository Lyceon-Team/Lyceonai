/**
 * The calendar data layer's public surface. Components import from here, never from the
 * modules directly, so the set of things a component can reach is a deliberate list.
 */
export { calendarKeys } from "./keys";
export {
  deviceTimezone,
  useCalendar,
  useGuardianCalendar,
  useStreak,
} from "./queries";
export {
  newIntent,
  useAcknowledge,
  useDoItNow,
  useEditDay,
  useLaunchMutation,
  useMoveBlock,
  useRegenerateDay,
  useRegeneratePlan,
  useResetDay,
  useStudyProfileMutation,
  type DayScopedVariables,
  type DoItNowVariables,
  type EditDayVariables,
  type Intent,
  type LaunchVariables,
  type MoveBlockVariables,
  type RegenerateVariables,
} from "./mutations";
export {
  isLaunchable,
  practiceStateKey,
  prefetchPracticeChunk,
  useLaunchBlock,
  type LaunchOutcome,
} from "./launch";
export {
  applyAcknowledge,
  applyBlockEdit,
  applyDoItNow,
  applyMove,
  applyRemoveBlock,
  findBlock,
  isProvisional,
  nextProvisionalId,
  resetProvisionalIds,
  PROVISIONAL_PREFIX,
} from "./optimistic";
