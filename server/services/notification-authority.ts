import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

type NotificationTopic = "study_reminders" | "streak" | "plan_updates" | "guardian_updates" | "marketing";
type DigestFrequency = "never" | "daily" | "weekly";

type NotificationPreferenceRow = {
  user_id: string;
  email_enabled: boolean;
  study_reminders_enabled: boolean;
  streak_enabled: boolean;
  plan_updates_enabled: boolean;
  guardian_updates_enabled: boolean;
  marketing_enabled: boolean;
  digest_frequency: DigestFrequency;
  quiet_hours: Record<string, unknown> | null;
};

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceRow = {
  user_id: "",
  email_enabled: false,
  study_reminders_enabled: true,
  streak_enabled: true,
  plan_updates_enabled: true,
  guardian_updates_enabled: true,
  marketing_enabled: false,
  digest_frequency: "daily",
  quiet_hours: null,
};

export type NotificationChannelDecision = {
  inApp: boolean;
  email: boolean;
  digest: boolean;
  suppressedReason: string | null;
};

export type NotificationDecisionResult = {
  created: boolean;
  notificationId: string | null;
  channels: NotificationChannelDecision;
};

export type PreferenceAwareNotificationInput = {
  userId: string;
  topic: NotificationTopic;
  type: string;
  category: string;
  title: string;
  body: string;
  priority?: "low" | "normal" | "high" | "urgent";
  ctaUrl?: string | null;
  ctaText?: string | null;
  channelOrigin?: string | null;
  metadata?: Record<string, unknown> | null;
  dedupeWindowMinutes?: number;
};

async function loadPreferences(userId: string): Promise<NotificationPreferenceRow> {
  const { data, error } = await supabaseServer
    .from("user_notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`notification_preferences_load_failed:${error.message}`);
  }

  if (!data) {
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      user_id: userId,
    };
  }

  return {
    user_id: userId,
    email_enabled: Boolean(data.email_enabled),
    study_reminders_enabled: Boolean(data.study_reminders_enabled),
    streak_enabled: Boolean(data.streak_enabled),
    plan_updates_enabled: Boolean(data.plan_updates_enabled),
    guardian_updates_enabled: Boolean(data.guardian_updates_enabled),
    marketing_enabled: Boolean(data.marketing_enabled),
    digest_frequency:
      data.digest_frequency === "never" || data.digest_frequency === "weekly" ? data.digest_frequency : "daily",
    quiet_hours: (data.quiet_hours as Record<string, unknown> | null) ?? null,
  };
}

function topicEnabled(prefs: NotificationPreferenceRow, topic: NotificationTopic): boolean {
  if (topic === "study_reminders") return prefs.study_reminders_enabled;
  if (topic === "streak") return prefs.streak_enabled;
  if (topic === "plan_updates") return prefs.plan_updates_enabled;
  if (topic === "guardian_updates") return prefs.guardian_updates_enabled;
  return prefs.marketing_enabled;
}

function disabledReasonForTopic(topic: NotificationTopic): string {
  if (topic === "study_reminders") return "study_reminders_disabled";
  if (topic === "streak") return "streak_disabled";
  if (topic === "plan_updates") return "plan_updates_disabled";
  if (topic === "guardian_updates") return "guardian_updates_disabled";
  return "marketing_disabled";
}

function mapNotificationKindToTopic(kind: string): NotificationTopic {
  const normalized = String(kind || "").trim().toLowerCase();
  if (normalized === "study_reminder" || normalized === "study_reminders") return "study_reminders";
  if (normalized === "streak" || normalized === "streak_update") return "streak";
  if (normalized === "guardian" || normalized === "guardian_update") return "guardian_updates";
  if (normalized === "marketing") return "marketing";
  return "plan_updates";
}

async function hasRecentDuplicate(input: PreferenceAwareNotificationInput): Promise<boolean> {
  const windowMinutes = Math.max(0, Math.round(input.dedupeWindowMinutes ?? 0));
  if (windowMinutes <= 0) {
    return false;
  }

  const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabaseServer
    .from("notifications")
    .select("id")
    .eq("user_id", input.userId)
    .eq("type", input.type)
    .eq("title", input.title)
    .eq("channel_origin", input.channelOrigin ?? "central_preference_writer")
    .is("archived_at", null)
    .gte("created_at", sinceIso)
    .limit(1);

  if (error) {
    throw new Error(`notification_dedupe_lookup_failed:${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

export async function createPreferenceAwareNotification(
  input: PreferenceAwareNotificationInput,
): Promise<NotificationDecisionResult> {
  const prefs = await loadPreferences(input.userId);
  const enabled = topicEnabled(prefs, input.topic);

  if (!enabled) {
    return {
      created: false,
      notificationId: null,
      channels: {
        inApp: false,
        email: false,
        digest: false,
        suppressedReason: disabledReasonForTopic(input.topic),
      },
    };
  }

  const channels: NotificationChannelDecision = {
    inApp: true,
    email: prefs.email_enabled,
    digest: prefs.digest_frequency !== "never",
    suppressedReason: null,
  };

  if (await hasRecentDuplicate(input)) {
    return {
      created: false,
      notificationId: null,
      channels: {
        ...channels,
        inApp: false,
        suppressedReason: "suppressed_by_dedupe_window",
      },
    };
  }

  const payload = {
    user_id: input.userId,
    type: input.type,
    category: input.category,
    title: input.title,
    body: input.body,
    message: input.body,
    priority: input.priority ?? "normal",
    cta_url: input.ctaUrl ?? null,
    action_url: input.ctaUrl ?? null,
    cta_text: input.ctaText ?? null,
    action_text: input.ctaText ?? null,
    channel_origin: input.channelOrigin ?? "central_preference_writer",
    metadata: {
      ...(input.metadata ?? {}),
      delivery: {
        in_app: channels.inApp,
        email: channels.email,
        digest: channels.digest,
      },
      authority: "central_preference_writer",
      topic: input.topic,
    },
    is_read: false,
    read_at: null,
    archived_at: null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseServer
    .from("notifications")
    .insert(payload)
    .select("id");

  if (error) {
    throw new Error(`notification_insert_failed:${error.message}`);
  }

  return {
    created: true,
    notificationId: (Array.isArray(data) ? (data[0]?.id as string | undefined) : (data as any)?.id) ?? null,
    channels,
  };
}

export async function writeNotificationDecision(args: {
  recipientUserIds: string[];
  kind: string;
  type: string;
  category: string;
  title: string;
  body: string;
  priority?: "low" | "normal" | "high" | "urgent";
  ctaUrl?: string | null;
  ctaText?: string | null;
  channelOrigin?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{
  userId: string;
  delivered: boolean;
  suppressed: boolean;
  reason: string | null;
  notificationId: string | null;
}> {
  const userId = args.recipientUserIds[0];
  if (!userId) {
    return {
      userId: "",
      delivered: false,
      suppressed: true,
      reason: "no_recipient",
      notificationId: null,
    };
  }

  const decision = await createPreferenceAwareNotification({
    userId,
    topic: mapNotificationKindToTopic(args.kind),
    type: args.type,
    category: args.category,
    title: args.title,
    body: args.body,
    priority: args.priority,
    ctaUrl: args.ctaUrl ?? null,
    ctaText: args.ctaText ?? null,
    channelOrigin: args.channelOrigin ?? "central_preference_writer",
    metadata: args.metadata ?? null,
  });

  return {
    userId,
    delivered: decision.created,
    suppressed: !decision.created,
    reason: decision.channels.suppressedReason,
    notificationId: decision.notificationId,
  };
}

export async function fanoutNotificationDecisions(args: {
  recipientUserIds: string[];
  kind: string;
  type: string;
  category: string;
  title: string;
  body: string;
  priority?: "low" | "normal" | "high" | "urgent";
  ctaUrl?: string | null;
  ctaText?: string | null;
  channelOrigin?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{
  delivered: number;
  suppressed: number;
  decisions: Array<{ userId: string; delivered: boolean; suppressed: boolean; reason: string | null; notificationId: string | null }>;
}> {
  const decisions: Array<{ userId: string; delivered: boolean; suppressed: boolean; reason: string | null; notificationId: string | null }> = [];

  for (const userId of args.recipientUserIds) {
    const decision = await createPreferenceAwareNotification({
      userId,
      topic: mapNotificationKindToTopic(args.kind),
      type: args.type,
      category: args.category,
      title: args.title,
      body: args.body,
      priority: args.priority,
      ctaUrl: args.ctaUrl ?? null,
      ctaText: args.ctaText ?? null,
      channelOrigin: args.channelOrigin ?? "central_preference_writer",
      metadata: args.metadata ?? null,
    });

    decisions.push({
      userId,
      delivered: decision.created,
      suppressed: !decision.created,
      reason: decision.channels.suppressedReason,
      notificationId: decision.notificationId,
    });
  }

  return {
    delivered: decisions.filter((entry) => entry.delivered).length,
    suppressed: decisions.filter((entry) => entry.suppressed).length,
    decisions,
  };
}

export async function publishCalendarEventNotification(args: {
  userId: string;
  eventType: "plan_generated" | "plan_refreshed" | "block_completed" | "day_edited" | "override_applied";
  details?: Record<string, unknown>;
}): Promise<NotificationDecisionResult | null> {
  const dayDate = typeof args.details?.day_date === "string" ? args.details.day_date : null;

  if (args.eventType === "plan_generated") {
    const mode = typeof args.details?.mode === "string" ? args.details.mode : "generate";
    return createPreferenceAwareNotification({
      userId: args.userId,
      topic: "plan_updates",
      type: "system_update",
      category: "study_progress",
      title: mode === "regenerate" ? "Plan regenerated" : "Plan generated",
      body: mode === "regenerate"
        ? "Your plan was regenerated with your latest profile and mastery context."
        : "Your study plan is ready.",
      ctaUrl: "/calendar",
      ctaText: "Open calendar",
      channelOrigin: "calendar_planner",
      metadata: { event_type: args.eventType, ...args.details },
      dedupeWindowMinutes: 30,
    });
  }

  if (args.eventType === "plan_refreshed" && args.details?.applied !== false) {
    return createPreferenceAwareNotification({
      userId: args.userId,
      topic: "plan_updates",
      type: "study_reminder",
      category: "study_progress",
      title: "Plan refreshed",
      body: "Your upcoming days were refreshed while preserving override-owned days.",
      ctaUrl: "/calendar",
      ctaText: "Review plan",
      channelOrigin: "calendar_planner",
      metadata: { event_type: args.eventType, ...args.details },
      dedupeWindowMinutes: 30,
    });
  }

  if (args.eventType === "block_completed") {
    return createPreferenceAwareNotification({
      userId: args.userId,
      topic: "streak",
      type: "achievement",
      category: "milestones",
      title: "Study block completed",
      body: dayDate ? `You completed your study block for ${dayDate}.` : "You completed a study block.",
      ctaUrl: "/calendar",
      ctaText: "View calendar",
      channelOrigin: "calendar_planner",
      metadata: { event_type: args.eventType, ...args.details },
      dedupeWindowMinutes: 15,
    });
  }

  return null;
}

export async function publishCalendarEventNotificationBestEffort(args: {
  userId: string;
  eventType: "plan_generated" | "plan_refreshed" | "block_completed" | "day_edited" | "override_applied";
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await publishCalendarEventNotification(args);
  } catch (error) {
    logger.warn("NOTIFICATIONS", "calendar_notification_best_effort_failed", "Failed to publish calendar notification", {
      userId: args.userId,
      eventType: args.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
