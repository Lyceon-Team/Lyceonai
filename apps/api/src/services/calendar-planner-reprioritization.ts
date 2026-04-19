import { DateTime } from "luxon";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  DEFAULT_HORIZON_DAYS,
  type BlockedWindow,
  type DayStatus,
  type FullTestCadence,
  type PrioritySkill,
  type SkillSignal,
  type StudyProfileSettings,
  type TaskType,
  generateDeterministicPlan,
  resolvePlannerWindow,
} from "./calendar-planner";

type PlannerMode = "auto" | "custom";
type GenerationSource = "auto" | "user" | "refresh" | "regenerate" | "generate";
type TaskStatus = "planned" | "in_progress" | "completed" | "skipped" | "missed";

type StudyProfileRow = {
  user_id: string;
  baseline_score: number | null;
  target_score: number | null;
  exam_date: string | null;
  daily_minutes: number | null;
  timezone: string | null;
  planner_mode: PlannerMode | null;
  full_test_cadence: FullTestCadence | null;
  study_days_of_week: number[] | null;
  preferred_study_days: number[] | null;
  blocked_weekdays: number[] | null;
  blocked_dates: string[] | null;
  blocked_windows: BlockedWindow[] | null;
  created_at?: string;
  updated_at?: string;
};

type PlanDayRow = {
  id: string;
  user_id: string;
  day_date: string;
  planned_minutes: number;
  completed_minutes: number;
  focus: unknown;
  tasks: unknown;
  plan_version: number;
  generated_at: string;
  is_user_override: boolean;
  status: DayStatus;
  generation_source: GenerationSource;
  is_exam_day: boolean;
  is_taper_day: boolean;
  is_full_test_day: boolean;
  required_task_count: number;
  completed_task_count: number;
  study_minutes_target: number;
  replaces_override: boolean;
  replaced_override_day_id: string | null;
  replacement_source: GenerationSource | null;
  replacement_at: string | null;
  created_at?: string;
  updated_at?: string;
};

type PlanTaskRow = {
  id: string;
  day_id: string;
  user_id: string;
  day_date: string;
  ordinal: number;
  task_type: TaskType;
  section: "MATH" | "RW" | null;
  duration_minutes: number;
  source_skill_code: string | null;
  source_domain: string | null;
  source_subskill: string | null;
  source_reason: Record<string, unknown>;
  status: TaskStatus;
  is_user_override: boolean;
  planner_owned: boolean;
  metadata: Record<string, unknown>;
  completed_at: string | null;
  replaces_override: boolean;
  replaced_override_task_id: string | null;
  replacement_source: GenerationSource | null;
  replacement_at: string | null;
  override_target_type: "practice_target" | "review_session" | "scheduled_full_length" | null;
  override_target_domain: string | null;
  override_target_skill: string | null;
  override_target_session_id: string | null;
  override_target_exam_id: string | null;
};

type AttemptRow = {
  attempted_at: string | null;
  is_correct: boolean | null;
  time_spent_ms: number | null;
  section: string | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  question_canonical_id: string | null;
  event_type: string | null;
};

type SkillMasteryRow = {
  section: string;
  domain: string | null;
  skill: string;
  mastery_score: number | null;
  accuracy: number | null;
  last_attempt_at: string | null;
};

export type ExamSkillDiagnostic = {
  section: "MATH" | "RW";
  domain: string;
  skill: string;
  accuracy: number;
  performanceBand: "strength" | "developing" | "needs_focus";
};

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_DAILY_MINUTES = 30;

type ProfileSummary = {
  timezone: string;
  examDate: string | null;
  dailyMinutes: number;
  plannerMode: PlannerMode;
  fullTestCadence: FullTestCadence;
  studyDaysOfWeek: number[];
  blockedWeekdays: number[];
  blockedDates: string[];
  blockedWindows: BlockedWindow[];
  preferredStudyDays: number[];
};

function asPlannerMode(value: unknown): PlannerMode {
  return value === "custom" ? "custom" : "auto";
}

function asFullTestCadence(value: unknown): FullTestCadence {
  if (value === "weekly" || value === "none") return value;
  return "biweekly";
}

function normalizePreferredStudyDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5, 6, 7];
  const days = Array.from(
    new Set(
      value
        .map((item) => (typeof item === "number" ? Math.trunc(item) : Number.NaN))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7),
    ),
  );
  return days.length > 0 ? days.sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7];
}

function normalizeBlockedWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = Array.from(
    new Set(
      value
        .map((item) => (typeof item === "number" ? Math.trunc(item) : Number.NaN))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7),
    ),
  );
  return days.length > 0 ? days.sort((a, b) => a - b) : [];
}

function normalizeBlockedDates(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  ).sort();
}

function normalizeBlockedWindows(value: unknown): BlockedWindow[] {
  if (!Array.isArray(value)) return [];
  const windows: BlockedWindow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<BlockedWindow>;
    const normalized: BlockedWindow = {};
    if (typeof candidate.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) {
      normalized.date = candidate.date;
    }
    if (typeof candidate.start === "string") {
      normalized.start = candidate.start;
    }
    if (typeof candidate.end === "string") {
      normalized.end = candidate.end;
    }
    if (typeof candidate.all_day === "boolean") {
      normalized.all_day = candidate.all_day;
    }
    if (typeof candidate.reason === "string") {
      normalized.reason = candidate.reason;
    }
    if (Object.keys(normalized).length > 0) {
      windows.push(normalized);
    }
  }
  return windows;
}

function normalizeSection(value: unknown): "MATH" | "RW" | null {
  const normalized = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (!normalized) return null;
  if (normalized === "math" || normalized === "m" || normalized.includes("math")) return "MATH";
  if (normalized === "rw" || normalized.includes("reading") || normalized.includes("writing")) return "RW";
  return null;
}

function profileSummaryFromRow(userId: string, row: StudyProfileRow | null): ProfileSummary & { userId: string } {
  const studyDaysOfWeek = normalizePreferredStudyDays(row?.study_days_of_week ?? row?.preferred_study_days);
  return {
    userId,
    timezone: row?.timezone || DEFAULT_TIMEZONE,
    examDate: row?.exam_date || null,
    dailyMinutes: Math.max(10, Math.min(240, row?.daily_minutes ?? DEFAULT_DAILY_MINUTES)),
    plannerMode: asPlannerMode(row?.planner_mode),
    fullTestCadence: asFullTestCadence(row?.full_test_cadence),
    studyDaysOfWeek,
    blockedWeekdays: normalizeBlockedWeekdays(row?.blocked_weekdays),
    blockedDates: normalizeBlockedDates(row?.blocked_dates),
    blockedWindows: normalizeBlockedWindows(row?.blocked_windows),
    preferredStudyDays: studyDaysOfWeek,
  };
}
function plannerSettingsFromSummary(summary: ProfileSummary & { userId: string }): StudyProfileSettings {
  return {
    userId: summary.userId,
    timezone: summary.timezone,
    dailyMinutes: summary.dailyMinutes,
    examDate: summary.examDate,
    fullTestCadence: summary.fullTestCadence,
    studyDaysOfWeek: summary.studyDaysOfWeek,
    blockedWeekdays: summary.blockedWeekdays,
    blockedDates: summary.blockedDates,
    blockedWindows: summary.blockedWindows,
  };
}

function taskSectionToLegacy(section: "MATH" | "RW" | null): string | null {
  if (section === "MATH") return "Math";
  if (section === "RW") return "Reading & Writing";
  return null;
}

function serializeTaskSummary(args: {
  taskType: TaskType;
  section: "MATH" | "RW" | null;
  durationMinutes: number;
  status?: TaskStatus;
  ordinal?: number;
  target: {
    section: "MATH" | "RW" | null;
    skill_code: string | null;
    domain: string | null;
    subskill: string | null;
    target_type: "practice_target" | "review_session" | "scheduled_full_length" | null;
    review_session_id: string | null;
    exam_id: string | null;
  };
  isUserOverride?: boolean;
  plannerOwned?: boolean;
  sourceReason?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  replacesOverride?: boolean;
  replacedOverrideTaskId?: string | null;
  replacementSource?: GenerationSource | null;
  replacementAt?: string | null;
  overrideTargetType?: "practice_target" | "review_session" | "scheduled_full_length" | null;
  overrideTargetDomain?: string | null;
  overrideTargetSkill?: string | null;
  overrideTargetSessionId?: string | null;
  overrideTargetExamId?: string | null;
  id?: string;
}): Record<string, unknown> {
  return {
    id: args.id,
    type: args.taskType,
    task_type: args.taskType,
    section: taskSectionToLegacy(args.section),
    target: args.target,
    override_target_type: args.overrideTargetType ?? args.target.target_type,
    override_target_domain: args.overrideTargetDomain ?? args.target.domain,
    override_target_skill: args.overrideTargetSkill ?? args.target.skill_code,
    override_target_session_id: args.overrideTargetSessionId ?? args.target.review_session_id,
    override_target_exam_id: args.overrideTargetExamId ?? args.target.exam_id,
    source_skill_code: args.target.skill_code,
    source_domain: args.target.domain,
    source_subskill: args.target.subskill,
    source_reason: args.sourceReason ?? {},
    metadata: args.metadata ?? {},
    mode:
      args.taskType === "full_length"
        ? "full-length"
        : args.taskType === "review_full_length"
          ? "review-full-length"
          : args.taskType === "review_practice"
            ? "review"
            : args.taskType === "focused_drill"
              ? "focused"
              : args.taskType === "tutor_support"
                ? "support"
                : "mixed",
    minutes: args.durationMinutes,
    status: args.status,
    ordinal: args.ordinal,
    is_user_override: args.isUserOverride,
    planner_owned: args.plannerOwned,
    replaces_override: args.replacesOverride,
    replaced_override_task_id: args.replacedOverrideTaskId ?? null,
    replacement_source: args.replacementSource ?? null,
    replacement_at: args.replacementAt ?? null,
  };
}

function buildReprioritizedReason(prioritySkill: PrioritySkill): Record<string, unknown> {
  return {
    mode: "normal",
    source: "full_length_exam",
    reprioritized: true,
    exam_session_id: prioritySkill.examSessionId ?? null,
    completed_at: prioritySkill.completedAt ?? null,
    skill: {
      skill_code: prioritySkill.skillCode,
      skill_label: prioritySkill.skillLabel,
      domain: prioritySkill.domain,
      accuracy: prioritySkill.accuracy,
      performanceBand: prioritySkill.performanceBand,
    },
  };
}

function buildReprioritizedMetadata(prioritySkill: PrioritySkill): Record<string, unknown> {
  return {
    reprioritized: true,
    source: "full_length_exam",
    exam_session_id: prioritySkill.examSessionId ?? null,
    completed_at: prioritySkill.completedAt ?? null,
    required: true,
  };
}

function normalizeSkillKey(value: string): string {
  return value.trim().toLowerCase();
}
async function loadProfile(userId: string): Promise<StudyProfileRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("student_study_profile")
    .select(
      "user_id, baseline_score, target_score, exam_date, daily_minutes, timezone, planner_mode, full_test_cadence, study_days_of_week, preferred_study_days, blocked_weekdays, blocked_dates, blocked_windows, created_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load study profile: ${error.message}`);
  return (data as StudyProfileRow | null) ?? null;
}

async function loadDaysByRange(userId: string, start: string, end: string): Promise<PlanDayRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("student_study_plan_days")
    .select(
      "id, user_id, day_date, planned_minutes, completed_minutes, focus, tasks, plan_version, generated_at, is_user_override, status, generation_source, is_exam_day, is_taper_day, is_full_test_day, required_task_count, completed_task_count, study_minutes_target, replaces_override, replaced_override_day_id, replacement_source, replacement_at, created_at, updated_at",
    )
    .eq("user_id", userId)
    .gte("day_date", start)
    .lte("day_date", end)
    .order("day_date", { ascending: true });
  if (error) throw new Error(`Failed to load plan days: ${error.message}`);
  return ((data as PlanDayRow[] | null) ?? []).map((row) => ({
    ...row,
    replaces_override: Boolean(row.replaces_override),
    replaced_override_day_id: row.replaced_override_day_id ?? null,
    replacement_source: (row.replacement_source as GenerationSource | null) ?? null,
    replacement_at: row.replacement_at ?? null,
    status: row.status ?? "planned",
  }));
}

async function loadTasksByRange(userId: string, start: string, end: string): Promise<PlanTaskRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("student_study_plan_tasks")
    .select(
      "id, day_id, user_id, day_date, ordinal, task_type, section, duration_minutes, source_skill_code, source_domain, source_subskill, source_reason, status, is_user_override, planner_owned, metadata, completed_at, replaces_override, replaced_override_task_id, replacement_source, replacement_at, override_target_type, override_target_domain, override_target_skill, override_target_session_id, override_target_exam_id",
    )
    .eq("user_id", userId)
    .gte("day_date", start)
    .lte("day_date", end)
    .order("day_date", { ascending: true })
    .order("ordinal", { ascending: true });
  if (error) throw new Error(`Failed to load plan tasks: ${error.message}`);
  return ((data as PlanTaskRow[] | null) ?? []).map((row) => ({
    ...row,
    status: row.status ?? "planned",
    source_reason: typeof row.source_reason === "object" && row.source_reason ? row.source_reason : {},
    metadata: typeof row.metadata === "object" && row.metadata ? row.metadata : {},
    replaces_override: Boolean(row.replaces_override),
    replaced_override_task_id: row.replaced_override_task_id ?? null,
    replacement_source: (row.replacement_source as GenerationSource | null) ?? null,
    replacement_at: row.replacement_at ?? null,
    override_target_type: (row.override_target_type as "practice_target" | "review_session" | "scheduled_full_length" | null) ?? null,
    override_target_domain: row.override_target_domain ?? null,
    override_target_skill: row.override_target_skill ?? null,
    override_target_session_id: row.override_target_session_id ?? null,
    override_target_exam_id: row.override_target_exam_id ?? null,
  }));
}

async function loadAttemptsByRange(userId: string, startUtc: string, endUtc: string): Promise<AttemptRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("student_question_attempts")
    .select("attempted_at, is_correct, time_spent_ms, section, domain, skill, subskill, question_canonical_id, event_type")
    .eq("user_id", userId)
    .gte("attempted_at", startUtc)
    .lte("attempted_at", endUtc)
    .order("attempted_at", { ascending: false });
  if (error) throw new Error(`Failed to load attempts: ${error.message}`);
  return (data as AttemptRow[] | null) ?? [];
}

async function loadSkillMasteryRows(userId: string): Promise<SkillMasteryRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, mastery_score, accuracy, last_attempt_at")
    .eq("user_id", userId);

  if (error || !data) return [];
  return data as SkillMasteryRow[];
}

function buildSkillSignals(rows: SkillMasteryRow[]): SkillSignal[] {
  const skillSignals: SkillSignal[] = [];
  for (const row of rows) {
    const section = normalizeSection(row.section);
    if (!section || !row.skill) continue;
    skillSignals.push({
      section,
      skillCode: row.skill,
      domain: row.domain ?? "general",
      subskill: null,
      masteryScore: typeof row.mastery_score === "number" ? row.mastery_score : 0.5,
      accuracy: typeof row.accuracy === "number" ? row.accuracy : 0.5,
      lastAttemptDate: row.last_attempt_at ? DateTime.fromISO(row.last_attempt_at).toISODate() : null,
    });
  }
  return skillSignals;
}

function mapDiagnosticsToPrioritySkills(params: {
  diagnostics: ExamSkillDiagnostic[];
  masteryRows: SkillMasteryRow[];
  examSessionId: string;
  completedAt: Date;
}): PrioritySkill[] {
  const masteryMap = new Map<string, SkillMasteryRow>();
  for (const row of params.masteryRows) {
    const section = normalizeSection(row.section);
    if (!section || !row.skill) continue;
    masteryMap.set(`${section}:${normalizeSkillKey(row.skill)}`, row);
  }

  const completedAtIso = params.completedAt.toISOString();
  const prioritized: PrioritySkill[] = [];

  for (const diagnostic of params.diagnostics) {
    if (diagnostic.performanceBand !== "needs_focus") continue;
    if (!diagnostic.skill || !diagnostic.domain) continue;
    const section = diagnostic.section;
    const normalizedKey = `${section}:${normalizeSkillKey(diagnostic.skill)}`;
    const mastery = masteryMap.get(normalizedKey);
    prioritized.push({
      section,
      domain: diagnostic.domain,
      skillCode: mastery?.skill ?? diagnostic.skill,
      skillLabel: diagnostic.skill,
      accuracy: Number.isFinite(diagnostic.accuracy) ? diagnostic.accuracy : 1,
      performanceBand: diagnostic.performanceBand,
      examSessionId: params.examSessionId,
      completedAt: completedAtIso,
    });
  }

  return prioritized.sort((a, b) => {
    if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
    const domainCompare = (a.domain ?? "").localeCompare(b.domain ?? "");
    if (domainCompare !== 0) return domainCompare;
    return a.skillLabel.localeCompare(b.skillLabel);
  });
}

async function persistGeneratedDays(params: {
  userId: string;
  timezone: string;
  todayDate: string;
  existingDays: PlanDayRow[];
  existingTasks: PlanTaskRow[];
  generatedDays: ReturnType<typeof generateDeterministicPlan>["plannedDays"];
  source: GenerationSource;
  skipOverrides: boolean;
}): Promise<{ upsertedDays: number; upsertedTasks: number; skippedOverrideDays: string[] }> {
  const supabase = getSupabaseAdmin();
  const existingDays = Array.isArray(params.existingDays) ? params.existingDays : [];
  const existingTasks = Array.isArray(params.existingTasks) ? params.existingTasks : [];
  const existingByDate = new Map(existingDays.map((day) => [day.day_date, day]));
  const existingTasksByDate = new Map<string, PlanTaskRow[]>();
  for (const task of existingTasks) {
    const group = existingTasksByDate.get(task.day_date) ?? [];
    group.push(task);
    existingTasksByDate.set(task.day_date, group);
  }
  const skippedOverrideDays: string[] = [];
  let upsertedDays = 0;
  let upsertedTasks = 0;

  for (const day of params.generatedDays) {
    if (day.dayDate < params.todayDate) continue;
    const existing = existingByDate.get(day.dayDate);
    if (existing && params.source !== "user" && (existing.status === "completed" || existing.status === "partially_completed")) {
      continue;
    }
    if (params.skipOverrides && existing?.is_user_override) {
      skippedOverrideDays.push(day.dayDate);
      continue;
    }

    const replacementAt = existing && existing.is_user_override && params.source === "regenerate" ? DateTime.now().toUTC().toISO() : null;
    const replacesOverride = Boolean(existing?.is_user_override && params.source === "regenerate");
    const existingOverrideTasks = (existingTasksByDate.get(day.dayDate) ?? []).filter((task) => task.is_user_override);
    const fallbackOverrideTasks = Array.isArray(existing?.tasks)
      ? (existing.tasks as Array<any>).filter((task) => Boolean(task?.id) && (task?.is_user_override === true || existing?.is_user_override))
      : [];
    const generatedTaskRows = day.tasks.map((task, index) => {
      const metadata: Record<string, unknown> = {
        ...(task.metadata ?? {}),
        required: task.required,
      };
      const replacedOverrideTask =
        existingOverrideTasks[index] ??
        fallbackOverrideTasks[index] ??
        existingOverrideTasks[0] ??
        fallbackOverrideTasks[0] ??
        null;
      return {
        day_id: existing?.id ?? "",
        user_id: params.userId,
        day_date: day.dayDate,
        ordinal: index + 1,
        task_type: task.taskType,
        section: task.section,
        duration_minutes: task.durationMinutes,
        source_skill_code: task.sourceSkillCode,
        source_domain: task.sourceDomain,
        source_subskill: task.sourceSubskill,
        source_reason: task.sourceReason,
        status: "planned" as const,
        is_user_override: false,
        planner_owned: true,
        metadata,
        completed_at: null,
        replaces_override: replacesOverride,
        replaced_override_task_id: replacedOverrideTask?.id ?? existing?.id ?? null,
        replacement_source: replacesOverride ? params.source : null,
        replacement_at: replacementAt,
        override_target_type: null,
        override_target_domain: null,
        override_target_skill: null,
        override_target_session_id: null,
        override_target_exam_id: null,
      };
    });

    const dayRowPayload = {
      user_id: params.userId,
      day_date: day.dayDate,
      planned_minutes: day.plannedMinutes,
      completed_minutes: existing?.completed_minutes ?? 0,
      focus: day.focus.map((focus) => ({
        section: focus.section === "MATH" ? "Math" : "Reading & Writing",
        weight: focus.weight,
        competencies: focus.skill_codes,
      })),
      tasks: generatedTaskRows.map((task) =>
        serializeTaskSummary({
          taskType: task.task_type,
          section: task.section,
          durationMinutes: task.duration_minutes,
          status: task.status,
          ordinal: task.ordinal,
          target: {
            section: task.section,
            skill_code: task.source_skill_code,
            domain: task.source_domain,
            subskill: task.source_subskill,
            target_type: task.override_target_type,
            review_session_id: task.override_target_session_id,
            exam_id: task.override_target_exam_id,
          },
          isUserOverride: task.is_user_override,
          plannerOwned: task.planner_owned,
          sourceReason: task.source_reason,
          metadata: task.metadata,
          replacesOverride: task.replaces_override,
          replacedOverrideTaskId: task.replaced_override_task_id,
          replacementSource: task.replacement_source,
          replacementAt: task.replacement_at,
          overrideTargetType: task.override_target_type,
          overrideTargetDomain: task.override_target_domain,
          overrideTargetSkill: task.override_target_skill,
          overrideTargetSessionId: task.override_target_session_id,
          overrideTargetExamId: task.override_target_exam_id,
        }),
      ),
      plan_version: (existing?.plan_version ?? 0) + 1,
      generated_at: DateTime.now().toUTC().toISO(),
      is_user_override: false,
      status: "planned" as DayStatus,
      generation_source: params.source,
      is_exam_day: day.isExamDay,
      is_taper_day: day.isTaperDay,
      is_full_test_day: day.isFullTestDay,
      required_task_count: generatedTaskRows.filter((task) => task.metadata.required !== false).length,
      completed_task_count: 0,
      study_minutes_target: day.studyMinutesTarget,
      replaces_override: replacesOverride,
      replaced_override_day_id: replacesOverride ? existing?.id ?? null : null,
      replacement_source: replacesOverride ? params.source : null,
      replacement_at: replacementAt,
    };

    const { data: upsertedDay, error: upsertDayError } = await supabase
      .from("student_study_plan_days")
      .upsert(dayRowPayload, { onConflict: "user_id,day_date" })
      .select("id")
      .single();

    if (upsertDayError || !upsertedDay?.id) {
      throw new Error(`Failed to persist study day ${day.dayDate}: ${upsertDayError?.message ?? "missing id"}`);
    }
    upsertedDays += 1;

    const { error: deleteError } = await supabase
      .from("student_study_plan_tasks")
      .delete()
      .eq("user_id", params.userId)
      .eq("day_date", day.dayDate);
    if (deleteError) {
      throw new Error(`Failed to clear tasks for ${day.dayDate}: ${deleteError.message}`);
    }

    if (generatedTaskRows.length > 0) {
      const { error: insertTaskError } = await supabase.from("student_study_plan_tasks").insert(
        generatedTaskRows.map((task) => ({
          ...task,
          day_id: upsertedDay.id,
        })),
      );
      if (insertTaskError) {
        throw new Error(`Failed to persist tasks for ${day.dayDate}: ${insertTaskError.message}`);
      }
      upsertedTasks += generatedTaskRows.length;
    }
  }

  return { upsertedDays, upsertedTasks, skippedOverrideDays };
}

function isStudyDay(dayDate: string, profile: StudyProfileSettings): boolean {
  const weekday = DateTime.fromISO(dayDate).weekday;
  if (profile.blockedDates.includes(dayDate)) return false;
  if (profile.blockedWeekdays.includes(weekday)) return false;
  return profile.studyDaysOfWeek.includes(weekday);
}
async function insertReprioritizedTaskForCustomPlan(params: {
  userId: string;
  profile: StudyProfileSettings;
  prioritySkill: PrioritySkill;
  examSessionId: string;
  completedAt: string;
  startDate: string;
  endDate: string;
  existingDays: PlanDayRow[];
  existingTasks: PlanTaskRow[];
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const eligibleDay = params.existingDays
    .filter((day) => day.day_date >= params.startDate && day.day_date <= params.endDate)
    .filter((day) => !day.is_user_override)
    .filter((day) => !day.is_exam_day && !day.is_full_test_day)
    .find((day) => isStudyDay(day.day_date, params.profile));

  if (!eligibleDay) {
    return;
  }

  const dayTasks = params.existingTasks.filter((task) => task.day_date === eligibleDay.day_date);
  const hasExistingReprioritized = dayTasks.some(
    (task) => task.metadata?.reprioritized === true && task.metadata?.exam_session_id === params.examSessionId,
  );
  if (hasExistingReprioritized) {
    return;
  }

  const maxOrdinal = dayTasks.reduce((max, task) => Math.max(max, task.ordinal ?? 0), 0);
  const durationMinutes = Math.max(8, Math.round(params.profile.dailyMinutes * 0.25));
  const sourceReason = buildReprioritizedReason(params.prioritySkill);
  const metadata = buildReprioritizedMetadata(params.prioritySkill);

  const { data: inserted, error: insertError } = await supabase
    .from("student_study_plan_tasks")
    .insert({
      day_id: eligibleDay.id,
      user_id: params.userId,
      day_date: eligibleDay.day_date,
      ordinal: maxOrdinal + 1,
      task_type: "focused_drill",
      section: params.prioritySkill.section,
      duration_minutes: durationMinutes,
      source_skill_code: params.prioritySkill.skillCode,
      source_domain: params.prioritySkill.domain,
      source_subskill: null,
      source_reason: sourceReason,
      status: "planned",
      is_user_override: false,
      planner_owned: true,
      metadata,
      completed_at: null,
      replaces_override: false,
      replaced_override_task_id: null,
      replacement_source: null,
      replacement_at: null,
      override_target_type: null,
      override_target_domain: null,
      override_target_skill: null,
      override_target_session_id: null,
      override_target_exam_id: null,
    })
    .select(
      "id, day_id, user_id, day_date, ordinal, task_type, section, duration_minutes, source_skill_code, source_domain, source_subskill, source_reason, status, is_user_override, planner_owned, metadata, completed_at, replaces_override, replaced_override_task_id, replacement_source, replacement_at, override_target_type, override_target_domain, override_target_skill, override_target_session_id, override_target_exam_id",
    )
    .single();

  if (insertError || !inserted) {
    throw new Error(`Failed to insert reprioritized task: ${insertError?.message ?? "missing row"}`);
  }

  const taskSummary = serializeTaskSummary({
    id: inserted.id,
    taskType: inserted.task_type,
    section: inserted.section,
    durationMinutes: inserted.duration_minutes,
    status: inserted.status,
    ordinal: inserted.ordinal,
    target: {
      section: inserted.section,
      skill_code: inserted.source_skill_code,
      domain: inserted.source_domain,
      subskill: inserted.source_subskill,
      target_type: inserted.override_target_type,
      review_session_id: inserted.override_target_session_id,
      exam_id: inserted.override_target_exam_id,
    },
    isUserOverride: inserted.is_user_override,
    plannerOwned: inserted.planner_owned,
    sourceReason: inserted.source_reason,
    metadata: inserted.metadata,
    replacesOverride: inserted.replaces_override,
    replacedOverrideTaskId: inserted.replaced_override_task_id,
    replacementSource: inserted.replacement_source,
    replacementAt: inserted.replacement_at,
    overrideTargetType: inserted.override_target_type,
    overrideTargetDomain: inserted.override_target_domain,
    overrideTargetSkill: inserted.override_target_skill,
    overrideTargetSessionId: inserted.override_target_session_id,
    overrideTargetExamId: inserted.override_target_exam_id,
  });

  const existingTaskSummaries = Array.isArray(eligibleDay.tasks) ? (eligibleDay.tasks as Record<string, unknown>[]) : [];
  const updatedTaskSummaries = [...existingTaskSummaries, taskSummary];

  const updatedPlannedMinutes = Math.max(0, (eligibleDay.planned_minutes ?? 0) + durationMinutes);
  const updatedRequiredCount = Math.max(0, (eligibleDay.required_task_count ?? 0) + 1);

  const { error: dayUpdateError } = await supabase
    .from("student_study_plan_days")
    .update({
      planned_minutes: updatedPlannedMinutes,
      tasks: updatedTaskSummaries,
      required_task_count: updatedRequiredCount,
      plan_version: (eligibleDay.plan_version ?? 0) + 1,
      generated_at: DateTime.now().toUTC().toISO(),
      updated_at: DateTime.now().toUTC().toISO(),
    })
    .eq("id", eligibleDay.id)
    .eq("user_id", params.userId);

  if (dayUpdateError) {
    throw new Error(`Failed to update plan day ${eligibleDay.day_date}: ${dayUpdateError.message}`);
  }
}

export async function applyFullLengthExamPlannerReprioritization(params: {
  userId: string;
  examSessionId: string;
  completedAt: Date;
  skillDiagnostics: ExamSkillDiagnostic[];
}): Promise<void> {
  const profile = await loadProfile(params.userId);
  const summary = profileSummaryFromRow(params.userId, profile);
  const settings = plannerSettingsFromSummary(summary);

  const todayDate = DateTime.now().setZone(summary.timezone).toISODate();
  if (!todayDate) return;
  const tomorrowDate = DateTime.fromISO(todayDate).plus({ days: 1 }).toISODate();
  if (!tomorrowDate) return;

  const window = resolvePlannerWindow({
    startDate: tomorrowDate,
    todayDate,
    examDate: summary.examDate,
    requestedDays: DEFAULT_HORIZON_DAYS,
  });

  if (window.startDate > window.endDate) return;

  const startUtc = DateTime.fromISO(window.startDate, { zone: summary.timezone }).startOf("day").minus({ days: 40 }).toUTC().toISO()!;
  const endUtc = DateTime.fromISO(window.endDate, { zone: summary.timezone }).endOf("day").toUTC().toISO()!;

  const [existingDays, existingTasks, attempts, masteryRows, recentCompletedTests] = await Promise.all([
    loadDaysByRange(params.userId, window.startDate, window.endDate),
    loadTasksByRange(params.userId, DateTime.fromISO(window.startDate).minus({ days: 6 }).toISODate()!, window.endDate),
    loadAttemptsByRange(params.userId, startUtc, endUtc),
    loadSkillMasteryRows(params.userId),
    getSupabaseAdmin()
      .from("student_study_plan_tasks")
      .select("day_date")
      .eq("user_id", params.userId)
      .in("task_type", ["full_length", "full_length_exam"])
      .eq("status", "completed")
      .gte("day_date", DateTime.fromISO(window.startDate).minus({ days: 30 }).toISODate()!)
      .order("day_date", { ascending: false })
      .limit(20),
  ]);

  const prioritySkills = mapDiagnosticsToPrioritySkills({
    diagnostics: params.skillDiagnostics,
    masteryRows,
    examSessionId: params.examSessionId,
    completedAt: params.completedAt,
  });

  if (prioritySkills.length === 0) {
    return;
  }

  if (summary.plannerMode === "custom") {
    await insertReprioritizedTaskForCustomPlan({
      userId: params.userId,
      profile: settings,
      prioritySkill: prioritySkills[0],
      examSessionId: params.examSessionId,
      completedAt: params.completedAt.toISOString(),
      startDate: window.startDate,
      endDate: window.endDate,
      existingDays,
      existingTasks,
    });
    return;
  }

  const recentCompletedTestDays = ((recentCompletedTests.data as Array<{ day_date: string }> | null) ?? []).map(
    (row) => row.day_date,
  );

  const plan = generateDeterministicPlan({
    profile: settings,
    todayDate,
    startDate: window.startDate,
    endDate: window.endDate,
    attempts: attempts.map((attempt) => ({
      attemptedAt: attempt.attempted_at || DateTime.fromISO(todayDate).toUTC().toISO()!,
      section: normalizeSection(attempt.section),
      skillCode: attempt.skill || null,
      questionCanonicalId: attempt.question_canonical_id || null,
      isCorrect: Boolean(attempt.is_correct),
      eventType: attempt.event_type || null,
      timeSpentMs: Math.max(0, attempt.time_spent_ms || 0),
    })),
    skillSignals: buildSkillSignals(masteryRows),
    existingDays: existingDays.map((day) => ({
      dayDate: day.day_date,
      isUserOverride: day.is_user_override,
      status: day.status,
      isFullTestDay: day.is_full_test_day,
    })),
    existingTasks: existingTasks.map((task) => ({
      dayDate: task.day_date,
      taskType: task.task_type,
      section: task.section,
      durationMinutes: task.duration_minutes,
      sourceSkillCode: task.source_skill_code,
    })),
    recentCompletedTestDays,
    skipOverrideDays: true,
    prioritySkills,
  });

  await persistGeneratedDays({
    userId: params.userId,
    timezone: summary.timezone,
    todayDate,
    existingDays,
    existingTasks,
    generatedDays: plan.plannedDays,
    source: "refresh",
    skipOverrides: true,
  });
}
