import { DateTime } from "luxon";

export type PlannerMode = "auto" | "custom";
export type FullTestCadence = "weekly" | "biweekly" | "none";
export type TaskType =
  | "practice"
  | "focused_drill"
  | "review_practice"
  | "review_full_length"
  | "full_length"
  | "tutor_support";

export type BlockedWindow = {
  date?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  reason?: string;
};
export type DayStatus = "planned" | "partially_completed" | "completed" | "missed";

export type StudyProfileSettings = {
  userId: string;
  timezone: string;
  dailyMinutes: number;
  examDate: string | null;
  fullTestCadence: FullTestCadence;
  studyDaysOfWeek: number[];
  blockedWeekdays: number[];
  blockedDates: string[];
  blockedWindows: BlockedWindow[];
};

export type SkillSignal = {
  section: "MATH" | "RW";
  skillCode: string;
  domain: string;
  subskill: string | null;
  masteryScore: number;
  accuracy: number;
  lastAttemptDate: string | null;
};

export type PrioritySkill = {
  section: "MATH" | "RW";
  domain: string | null;
  skillCode: string;
  skillLabel: string;
  accuracy: number;
  performanceBand: "strength" | "developing" | "needs_focus";
  examSessionId?: string;
  completedAt?: string;
};

export type AttemptSignal = {
  attemptedAt: string;
  section: "MATH" | "RW" | null;
  skillCode: string | null;
  questionCanonicalId: string | null;
  isCorrect: boolean;
  eventType: string | null;
  timeSpentMs: number;
};

export type ExistingDaySignal = {
  dayDate: string;
  isUserOverride: boolean;
  status: DayStatus;
  isFullTestDay: boolean;
};

export type ExistingTaskSignal = {
  dayDate: string;
  taskType: TaskType;
  section: "MATH" | "RW" | null;
  durationMinutes: number;
  sourceSkillCode: string | null;
};

export type PlannedTask = {
  taskType: TaskType;
  section: "MATH" | "RW" | null;
  durationMinutes: number;
  sourceSkillCode: string | null;
  sourceDomain: string | null;
  sourceSubskill: string | null;
  sourceReason: Record<string, unknown>;
  metadata: Record<string, unknown>;
  required: boolean;
};

export type PlannedDay = {
  dayDate: string;
  plannedMinutes: number;
  studyMinutesTarget: number;
  focus: Array<{ section: "MATH" | "RW"; weight: number; skill_codes: string[] }>;
  isExamDay: boolean;
  isTaperDay: boolean;
  isFullTestDay: boolean;
  tasks: PlannedTask[];
};

export const DEFAULT_HORIZON_DAYS = 28;
export const REVIEW_WINDOW_DAYS = 4;
export const SCORING_WEIGHTS = {
  weakness: 0.65,
  recency: 0.20,
  maintenance: 0.15,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDateList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  ).sort();
}

function isBlockedDay(dayDate: string, profile: StudyProfileSettings): boolean {
  const weekday = DateTime.fromISO(dayDate).weekday;
  if (profile.blockedDates.includes(dayDate)) return true;
  if (profile.blockedWeekdays.includes(weekday)) return true;
  return profile.blockedWindows.some((window) => {
    if (!window.date) return false;
    if (window.date !== dayDate) return false;
    return window.all_day !== false;
  });
}

function isStudyDay(dayDate: string, profile: StudyProfileSettings): boolean {
  const weekday = DateTime.fromISO(dayDate).weekday;
  return profile.studyDaysOfWeek.includes(weekday) && !isBlockedDay(dayDate, profile);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function recencyGapScore(lastDate: string | null, dayDate: string): number {
  if (!lastDate) return 1;
  const gap = Math.max(0, Math.round(DateTime.fromISO(dayDate).diff(DateTime.fromISO(lastDate), "days").days));
  return clamp(gap / 7, 0, 1);
}

function frequencyInRecentDays(skillCode: string, dayDate: string, existingTasks: ExistingTaskSignal[]): number {
  const start = DateTime.fromISO(dayDate).minus({ days: 3 }).toISODate()!;
  return existingTasks.filter((task) => task.sourceSkillCode === skillCode && task.dayDate >= start && task.dayDate < dayDate).length;
}

function yesterdayMinutes(skillCode: string, dayDate: string, attempts: AttemptSignal[], timezone: string): number {
  const yesterday = DateTime.fromISO(dayDate).minus({ days: 1 }).toISODate();
  if (!yesterday) return 0;
  let totalMs = 0;
  for (const attempt of attempts) {
    if (!attempt.skillCode) continue;
    if (attempt.skillCode !== skillCode) continue;
    const localDate = DateTime.fromISO(attempt.attemptedAt).setZone(timezone).toISODate();
    if (localDate !== yesterday) continue;
    totalMs += Math.max(0, attempt.timeSpentMs);
  }
  return Math.round(totalMs / 60000);
}

function rankSectionCandidates(params: {
  userId: string;
  dayDate: string;
  section: "MATH" | "RW";
  dailyMinutes: number;
  timezone: string;
  candidates: SkillSignal[];
  attempts: AttemptSignal[];
  existingTasks: ExistingTaskSignal[];
}): SkillSignal[] {
  const sectionCandidates = params.candidates.filter((candidate) => candidate.section === params.section);
  if (sectionCandidates.length === 0) {
    return [
      {
        section: params.section,
        skillCode: params.section === "MATH" ? "math.algebra_basics" : "rw.command_of_evidence",
        domain: params.section === "MATH" ? "math_foundations" : "rw_foundations",
        subskill: null,
        masteryScore: 0.5,
        accuracy: 0.5,
        lastAttemptDate: null,
      },
    ];
  }

  const scored = sectionCandidates.map((candidate) => {
    const weakness = clamp(1 - candidate.masteryScore, 0, 1);
    const recency = recencyGapScore(candidate.lastAttemptDate, params.dayDate);
    const maintenance = clamp(candidate.accuracy, 0, 1);
    let score = weakness * SCORING_WEIGHTS.weakness + recency * SCORING_WEIGHTS.recency + maintenance * SCORING_WEIGHTS.maintenance;

    if (frequencyInRecentDays(candidate.skillCode, params.dayDate, params.existingTasks) >= 2) {
      score *= 0.6;
    }

    const yesterdaySkillMinutes = yesterdayMinutes(candidate.skillCode, params.dayDate, params.attempts, params.timezone);
    if (yesterdaySkillMinutes >= Math.max(10, Math.round(params.dailyMinutes * 0.3)) && weakness < 0.9) {
      score *= 0.55;
    }

    return {
      candidate,
      score,
      recency,
      weakness,
    };
  });

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.recency !== b.recency) return b.recency - a.recency;
    if (a.weakness !== b.weakness) return b.weakness - a.weakness;
    if (a.candidate.skillCode !== b.candidate.skillCode) return a.candidate.skillCode.localeCompare(b.candidate.skillCode);
    return stableHash(`${params.userId}|${params.dayDate}|${params.section}|${a.candidate.skillCode}`) -
      stableHash(`${params.userId}|${params.dayDate}|${params.section}|${b.candidate.skillCode}`);
  });

  return scored.map((entry) => entry.candidate);
}

function chooseTopBandCandidate(candidates: SkillSignal[], userId: string, dayDate: string, section: "MATH" | "RW"): SkillSignal {
  const topBand = candidates.slice(0, Math.min(3, candidates.length));
  const index = stableHash(`${userId}|${dayDate}|${section}|band`) % topBand.length;
  return topBand[index];
}

function chooseCompressedMajorSection(dayDate: string, userId: string, existingTasks: ExistingTaskSignal[]): "MATH" | "RW" {
  const previousDay = DateTime.fromISO(dayDate).minus({ days: 1 }).toISODate();
  if (previousDay) {
    const previousTasks = existingTasks.filter((task) => task.dayDate === previousDay && task.section != null);
    const math = previousTasks.filter((task) => task.section === "MATH").reduce((sum, task) => sum + task.durationMinutes, 0);
    const rw = previousTasks.filter((task) => task.section === "RW").reduce((sum, task) => sum + task.durationMinutes, 0);
    if (math > rw) return "RW";
    if (rw > math) return "MATH";
  }
  return stableHash(`${userId}|${dayDate}|compressed`) % 2 === 0 ? "MATH" : "RW";
}

function pickWeakestPrioritySkill(prioritySkills?: PrioritySkill[]): PrioritySkill | null {
  if (!prioritySkills || prioritySkills.length === 0) return null;
  const needsFocus = prioritySkills.filter((skill) => skill.performanceBand === "needs_focus");
  if (needsFocus.length === 0) return null;
  const sorted = [...needsFocus].sort((a, b) => {
    if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
    const domainCompare = (a.domain ?? "").localeCompare(b.domain ?? "");
    if (domainCompare !== 0) return domainCompare;
    return a.skillLabel.localeCompare(b.skillLabel);
  });
  return sorted[0];
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
  };
}

function applyPrioritySkillToDay(params: {
  dayTasks: PlannedTask[];
  dayFocus: PlannedDay["focus"];
  prioritySkill: PrioritySkill;
}): boolean {
  const { dayTasks, dayFocus, prioritySkill } = params;
  const candidateIndex = dayTasks.findIndex(
    (task) => task.taskType === "focused_drill" && (task.section === prioritySkill.section || task.section == null),
  );
  const fallbackIndex =
    candidateIndex >= 0
      ? candidateIndex
      : dayTasks.findIndex(
          (task) => (task.taskType === "practice" || task.taskType === "focused_drill") && task.section === prioritySkill.section,
        );
  const targetIndex =
    fallbackIndex >= 0
      ? fallbackIndex
      : dayTasks.findIndex((task) => task.taskType === "practice" || task.taskType === "focused_drill");

  if (targetIndex < 0) return false;

  const targetTask = dayTasks[targetIndex];
  dayTasks[targetIndex] = {
    ...targetTask,
    taskType: "focused_drill",
    section: prioritySkill.section,
    sourceSkillCode: prioritySkill.skillCode,
    sourceDomain: prioritySkill.domain,
    sourceSubskill: null,
    sourceReason: buildReprioritizedReason(prioritySkill),
    metadata: {
      ...(targetTask.metadata ?? {}),
      ...buildReprioritizedMetadata(prioritySkill),
    },
  };

  const focusEntry = dayFocus.find((entry) => entry.section === prioritySkill.section);
  if (focusEntry) {
    focusEntry.skill_codes = [prioritySkill.skillCode];
  } else {
    dayFocus.push({
      section: prioritySkill.section,
      weight: 1,
      skill_codes: [prioritySkill.skillCode],
    });
  }

  return true;
}

function shouldScheduleFullTest(params: {
  dayDate: string;
  todayDate: string;
  examDate: string | null;
  cadence: FullTestCadence;
  preferredStudyDays: number[];
  lastScheduledDay: string | null;
  recentCompletedTestDays: string[];
}): boolean {
  if (params.cadence === "none") return false;
  if (params.dayDate < params.todayDate) return false;
  if (params.examDate && params.dayDate >= params.examDate) return false;

  const day = DateTime.fromISO(params.dayDate);
  if (!params.preferredStudyDays.includes(day.weekday)) return false;

  const cadenceDays = params.cadence === "weekly" ? 7 : 14;
  if (params.lastScheduledDay) {
    const diff = Math.round(day.diff(DateTime.fromISO(params.lastScheduledDay), "days").days);
    if (diff < cadenceDays) return false;
  }
  for (const completedDay of params.recentCompletedTestDays) {
    const diff = Math.round(day.diff(DateTime.fromISO(completedDay), "days").days);
    if (diff >= 0 && diff < cadenceDays) return false;
  }
  return true;
}

function buildReviewTask(dayDate: string, attempts: AttemptSignal[], examDate: string | null): PlannedTask | null {
  const dayStart = DateTime.fromISO(dayDate).startOf("day");
  const windowStart = dayStart.minus({ days: REVIEW_WINDOW_DAYS });
  const misses = attempts.filter((attempt) => {
    const attempted = DateTime.fromISO(attempt.attemptedAt);
    if (!attempted.isValid) return false;
    if (attempted < windowStart || attempted >= dayStart) return false;
    return !attempt.isCorrect;
  });
  if (misses.length === 0) return null;

  const grouped = new Map<string, number>();
  for (const miss of misses) {
    const key = miss.questionCanonicalId || miss.skillCode || "unknown";
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }

  const top = [...grouped.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const examPriority = examDate ? clamp(1 - Math.max(0, DateTime.fromISO(examDate).diff(dayStart, "days").days) / 30, 0, 1) : 0;

  return {
    taskType: "review_practice",
    section: null,
    durationMinutes: 10,
    sourceSkillCode: top?.[0] ?? null,
    sourceDomain: null,
    sourceSubskill: null,
    sourceReason: {
      review_window_days: REVIEW_WINDOW_DAYS,
      selected_reference: top?.[0] ?? null,
      repeated_miss_count: top?.[1] ?? 0,
      exam_priority: examPriority,
    },
    metadata: {},
    required: true,
  };
}

export function resolvePlannerWindow(params: {
  startDate: string;
  todayDate: string;
  examDate: string | null;
  requestedDays?: number;
}): { startDate: string; endDate: string; horizonDays: number } {
  const clampedStart = params.startDate < params.todayDate ? params.todayDate : params.startDate;
  const horizonDays = Math.max(1, Math.min(DEFAULT_HORIZON_DAYS, params.requestedDays ?? DEFAULT_HORIZON_DAYS));
  const byHorizon = DateTime.fromISO(clampedStart).plus({ days: horizonDays - 1 }).toISODate()!;
  const endDate = params.examDate && params.examDate < byHorizon ? params.examDate : byHorizon;
  const normalizedHorizonDays = Math.max(1, Math.round(DateTime.fromISO(endDate).diff(DateTime.fromISO(clampedStart), "days").days) + 1);
  return {
    startDate: clampedStart,
    endDate,
    horizonDays: normalizedHorizonDays,
  };
}

export function generateDeterministicPlan(params: {
  profile: StudyProfileSettings;
  todayDate: string;
  startDate: string;
  endDate: string;
  attempts: AttemptSignal[];
  skillSignals: SkillSignal[];
  existingDays: ExistingDaySignal[];
  existingTasks: ExistingTaskSignal[];
  recentCompletedTestDays: string[];
  skipOverrideDays: boolean;
  prioritySkills?: PrioritySkill[];
}): { plannedDays: PlannedDay[]; skippedOverrideDays: string[] } {
  const existingDayByDate = new Map(params.existingDays.map((day) => [day.dayDate, day]));
  const existingTaskList = [...params.existingTasks];
  const skippedOverrideDays: string[] = [];
  const plannedDays: PlannedDay[] = [];
  const prioritySkill = pickWeakestPrioritySkill(params.prioritySkills);
  let priorityInjected = false;

  let lastScheduledFullTestDate: string | null = null;
  let previousGeneratedWasFullTest = false;

  const totalDays = Math.max(0, Math.round(DateTime.fromISO(params.endDate).diff(DateTime.fromISO(params.startDate), "days").days)) + 1;
  for (let offset = 0; offset < totalDays; offset += 1) {
    const dayDate = DateTime.fromISO(params.startDate).plus({ days: offset }).toISODate()!;
    const existingDay = existingDayByDate.get(dayDate);

    if (dayDate < params.todayDate) {
      previousGeneratedWasFullTest = existingDay?.isFullTestDay ?? false;
      continue;
    }

    if (params.skipOverrideDays && existingDay?.isUserOverride) {
      skippedOverrideDays.push(dayDate);
      previousGeneratedWasFullTest = existingDay.isFullTestDay;
      continue;
    }

    if (!isStudyDay(dayDate, params.profile)) {
      plannedDays.push({
        dayDate,
        plannedMinutes: 0,
        studyMinutesTarget: 0,
        focus: [],
        isExamDay: false,
        isTaperDay: false,
        isFullTestDay: false,
        tasks: [],
      });
      previousGeneratedWasFullTest = false;
      continue;
    }

    const isExamDay = Boolean(params.profile.examDate && dayDate === params.profile.examDate);
    const isTaperDay = Boolean(params.profile.examDate && dayDate === DateTime.fromISO(params.profile.examDate).minus({ days: 1 }).toISODate());
    const isFullTestDay = shouldScheduleFullTest({
      dayDate,
      todayDate: params.todayDate,
      examDate: params.profile.examDate,
      cadence: params.profile.fullTestCadence,
      preferredStudyDays: params.profile.studyDaysOfWeek,
      lastScheduledDay: lastScheduledFullTestDate,
      recentCompletedTestDays: params.recentCompletedTestDays,
    }) && !isExamDay && !isTaperDay;

    if (isFullTestDay) {
      lastScheduledFullTestDate = dayDate;
    }

    const dayTasks: PlannedTask[] = [];
    const dayFocus: PlannedDay["focus"] = [];

    if (isExamDay) {
      plannedDays.push({
        dayDate,
        plannedMinutes: 0,
        studyMinutesTarget: 0,
        focus: [],
        isExamDay: true,
        isTaperDay: false,
        isFullTestDay: false,
        tasks: [],
      });
      previousGeneratedWasFullTest = false;
      continue;
    }

    if (isFullTestDay) {
      const minutes = Math.max(90, params.profile.dailyMinutes);
      dayTasks.push({
        taskType: "full_length",
        section: null,
        durationMinutes: minutes,
        sourceSkillCode: null,
        sourceDomain: null,
        sourceSubskill: null,
        sourceReason: { cadence: params.profile.fullTestCadence },
        metadata: { cadence: params.profile.fullTestCadence },
        required: true,
      });
    } else {
      const rankedMath = rankSectionCandidates({
        userId: params.profile.userId,
        dayDate,
        section: "MATH",
        dailyMinutes: params.profile.dailyMinutes,
        timezone: params.profile.timezone,
        candidates: params.skillSignals,
        attempts: params.attempts,
        existingTasks: existingTaskList,
      });
      const rankedRw = rankSectionCandidates({
        userId: params.profile.userId,
        dayDate,
        section: "RW",
        dailyMinutes: params.profile.dailyMinutes,
        timezone: params.profile.timezone,
        candidates: params.skillSignals,
        attempts: params.attempts,
        existingTasks: existingTaskList,
      });
      const mathPick = chooseTopBandCandidate(rankedMath, params.profile.userId, dayDate, "MATH");
      const rwPick = chooseTopBandCandidate(rankedRw, params.profile.userId, dayDate, "RW");

      const effectiveMinutes = isTaperDay ? Math.max(10, Math.round(params.profile.dailyMinutes * 0.4)) : params.profile.dailyMinutes;
      const reviewMinutes = effectiveMinutes < 25 ? 6 : previousGeneratedWasFullTest ? Math.max(12, Math.round(effectiveMinutes * 0.4)) : Math.max(8, Math.round(effectiveMinutes * 0.25));
      const sectionBudget = Math.max(0, effectiveMinutes - reviewMinutes);

      if (effectiveMinutes < 25) {
        const majorSection = chooseCompressedMajorSection(dayDate, params.profile.userId, existingTaskList);
        const minorSection: "MATH" | "RW" = majorSection === "MATH" ? "RW" : "MATH";
        const majorPick = majorSection === "MATH" ? mathPick : rwPick;
        const minorPick = minorSection === "MATH" ? mathPick : rwPick;
        const majorMinutes = Math.max(6, Math.round(sectionBudget * 0.7));
        const minorMinutes = Math.max(0, sectionBudget - majorMinutes);

        dayTasks.push({
          taskType: "focused_drill",
          section: majorSection,
          durationMinutes: majorMinutes,
          sourceSkillCode: majorPick.skillCode,
          sourceDomain: majorPick.domain,
          sourceSubskill: majorPick.subskill,
          sourceReason: { mode: "compressed_major" },
          metadata: { compressed: true },
          required: true,
        });
        if (minorMinutes >= 4) {
          dayTasks.push({
            taskType: "focused_drill",
            section: minorSection,
            durationMinutes: minorMinutes,
            sourceSkillCode: minorPick.skillCode,
            sourceDomain: minorPick.domain,
            sourceSubskill: minorPick.subskill,
            sourceReason: { mode: "compressed_minor" },
            metadata: { compressed: true },
            required: true,
          });
        }
      } else {
        const mathMinutes = Math.max(8, Math.round(sectionBudget * 0.5));
        const rwMinutes = Math.max(8, sectionBudget - mathMinutes);
        dayTasks.push({
          taskType: "practice",
          section: "MATH",
          durationMinutes: mathMinutes,
          sourceSkillCode: mathPick.skillCode,
          sourceDomain: mathPick.domain,
          sourceSubskill: mathPick.subskill,
          sourceReason: { mode: previousGeneratedWasFullTest ? "recovery" : "normal", weights: SCORING_WEIGHTS },
          metadata: {},
          required: true,
        });
        dayTasks.push({
          taskType: "practice",
          section: "RW",
          durationMinutes: rwMinutes,
          sourceSkillCode: rwPick.skillCode,
          sourceDomain: rwPick.domain,
          sourceSubskill: rwPick.subskill,
          sourceReason: { mode: previousGeneratedWasFullTest ? "recovery" : "normal", weights: SCORING_WEIGHTS },
          metadata: {},
          required: true,
        });
      }

      const reviewTaskType: TaskType = previousGeneratedWasFullTest ? "review_full_length" : "review_practice";
      const reviewTask = buildReviewTask(dayDate, params.attempts, params.profile.examDate);
      if (reviewTask) {
        reviewTask.taskType = reviewTaskType;
        reviewTask.durationMinutes = reviewMinutes;
        dayTasks.push(reviewTask);
      } else if (effectiveMinutes >= 25) {
        dayTasks.push({
          taskType: reviewTaskType,
          section: null,
          durationMinutes: reviewMinutes,
          sourceSkillCode: null,
          sourceDomain: null,
          sourceSubskill: null,
          sourceReason: { mode: "maintenance_review" },
          metadata: {},
          required: true,
        });
      }

      dayFocus.push(
        { section: "MATH", weight: 0.5, skill_codes: [mathPick.skillCode] },
        { section: "RW", weight: 0.5, skill_codes: [rwPick.skillCode] }
      );
    }

    const plannedMinutes = dayTasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    const plannedDay: PlannedDay = {
      dayDate,
      plannedMinutes,
      studyMinutesTarget: isTaperDay ? Math.max(10, Math.round(params.profile.dailyMinutes * 0.4)) : params.profile.dailyMinutes,
      focus: dayFocus,
      isExamDay: false,
      isTaperDay,
      isFullTestDay,
      tasks: dayTasks,
    };
    if (!priorityInjected && prioritySkill && !isExamDay && !isFullTestDay && dayTasks.length > 0) {
      if (applyPrioritySkillToDay({ dayTasks, dayFocus, prioritySkill })) {
        priorityInjected = true;
      }
    }
    plannedDays.push(plannedDay);

    existingTaskList.push(
      ...dayTasks.map((task) => ({
        dayDate,
        taskType: task.taskType,
        section: task.section,
        durationMinutes: task.durationMinutes,
        sourceSkillCode: task.sourceSkillCode,
      }))
    );
    previousGeneratedWasFullTest = isFullTestDay;
  }

  return { plannedDays, skippedOverrideDays };
}
