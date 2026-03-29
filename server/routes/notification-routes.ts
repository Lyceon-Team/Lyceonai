import { Router, Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger.js";
import { requireSupabaseAuth } from "../middleware/supabase-auth.js";
import { csrfGuard } from "../middleware/csrf.js";

const router = Router();
const csrfProtection = csrfGuard();

const DEFAULT_NOTIFICATION_PREFERENCES = {
  email_enabled: false,
  study_reminders_enabled: true,
  streak_enabled: true,
  plan_updates_enabled: true,
  guardian_updates_enabled: true,
  marketing_enabled: false,
  digest_frequency: "daily",
  quiet_hours: null,
};

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (!Number.isFinite(ts)) return false;
  return ts < Date.now();
}

function normalizeNotification(row: Record<string, any>) {
  const body = typeof row.body === "string" && row.body.trim() ? row.body : typeof row.message === "string" ? row.message : "";
  const ctaUrl = typeof row.cta_url === "string" ? row.cta_url : typeof row.action_url === "string" ? row.action_url : null;
  const ctaText = typeof row.cta_text === "string" ? row.cta_text : typeof row.action_text === "string" ? row.action_text : null;

  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    category: row.category,
    priority: row.priority,
    title: row.title,
    body,
    ctaUrl,
    ctaText,
    channelOrigin: typeof row.channel_origin === "string" ? row.channel_origin : null,
    metadata: row.metadata ?? null,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
    archivedAt: row.archived_at ?? null,
    expiresAt: row.expires_at ?? null,
    updatedAt: row.updated_at ?? null,
    message: row.message ?? body,
    actionUrl: ctaUrl,
    actionText: ctaText,
  };
}

function normalizeQuietHours(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeDigestFrequency(value: unknown): "never" | "daily" | "weekly" {
  if (value === "never" || value === "daily" || value === "weekly") return value;
  return "daily";
}

function normalizePreferences(row: Record<string, any>) {
  return {
    userId: row.user_id,
    emailEnabled: Boolean(row.email_enabled),
    studyRemindersEnabled: Boolean(row.study_reminders_enabled),
    streakEnabled: Boolean(row.streak_enabled),
    planUpdatesEnabled: Boolean(row.plan_updates_enabled),
    guardianUpdatesEnabled: Boolean(row.guardian_updates_enabled),
    marketingEnabled: Boolean(row.marketing_enabled),
    digestFrequency: normalizeDigestFrequency(row.digest_frequency),
    quietHours: normalizeQuietHours(row.quiet_hours),
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * GET /api/notifications
 * Canonical per-user notification list.
 */
router.get("/", requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseServer
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .is("archived_at", null)
      .or(`expires_at.is.null,expires_at.gte.${nowIso}`)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error("NOTIFICATIONS", "get_notifications_error", "Failed to fetch notifications", error);
      return res.status(500).json({ error: "Failed to fetch notifications" });
    }

    const notifications = (data || []).map(normalizeNotification).filter((n) => !isExpired(n.expiresAt));
    res.json(notifications);
  } catch (error) {
    logger.error("NOTIFICATIONS", "get_notifications_error", "Failed to fetch notifications", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

/**
 * GET /api/notifications/unread-count
 * Counts unread per-user notifications only.
 */
router.get("/unread-count", requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const nowIso = new Date().toISOString();

    const { count, error } = await supabaseServer
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false)
      .is("archived_at", null)
      .or(`expires_at.is.null,expires_at.gte.${nowIso}`);

    if (error) {
      logger.error("NOTIFICATIONS", "get_unread_count_error", "Failed to fetch unread count", error);
      return res.status(500).json({ error: "Failed to fetch unread count" });
    }

    res.json({ count: count || 0 });
  } catch (error) {
    logger.error("NOTIFICATIONS", "get_unread_count_error", "Failed to fetch unread count", error);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks a single per-user notification as read.
 */
router.patch("/:id/read", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const notificationId = req.params.id;

    const { data: notification, error: fetchError } = await supabaseServer
      .from("notifications")
      .select("*")
      .eq("id", notificationId)
      .eq("user_id", userId)
      .is("archived_at", null)
      .maybeSingle();

    if (fetchError) {
      logger.error("NOTIFICATIONS", "get_notification_error", "Failed to load notification", fetchError);
      return res.status(500).json({ error: "Failed to load notification" });
    }

    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabaseServer
      .from("notifications")
      .update({ is_read: true, read_at: nowIso, updated_at: nowIso })
      .eq("id", notificationId)
      .eq("user_id", userId)
      .is("archived_at", null);

    if (updateError) {
      throw updateError;
    }

    logger.info("NOTIFICATIONS", "notification_read", "Notification marked as read", {
      userId,
      notificationId,
    });

    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    logger.error("NOTIFICATIONS", "mark_read_error", "Failed to mark notification as read", error);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

/**
 * PATCH /api/notifications/mark-all-read
 * Marks all unread per-user notifications as read.
 */
router.patch("/mark-all-read", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const nowIso = new Date().toISOString();

    const { error } = await supabaseServer
      .from("notifications")
      .update({ is_read: true, read_at: nowIso, updated_at: nowIso })
      .eq("user_id", userId)
      .eq("is_read", false)
      .is("archived_at", null);

    if (error) {
      throw error;
    }

    logger.info("NOTIFICATIONS", "all_notifications_read", "All user notifications marked as read", {
      userId,
    });

    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    logger.error("NOTIFICATIONS", "mark_all_read_error", "Failed to mark all notifications as read", error);
    res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
});

/**
 * GET /api/notifications/preferences
 * Returns persisted notification preferences for the current user.
 */
router.get("/preferences", requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await supabaseServer
      .from("user_notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      logger.error("NOTIFICATIONS", "get_preferences_error", "Failed to fetch notification preferences", error);
      return res.status(500).json({ error: "Failed to fetch notification preferences" });
    }

    if (!data) {
      return res.json({
        preferences: {
          userId,
          emailEnabled: DEFAULT_NOTIFICATION_PREFERENCES.email_enabled,
          studyRemindersEnabled: DEFAULT_NOTIFICATION_PREFERENCES.study_reminders_enabled,
          streakEnabled: DEFAULT_NOTIFICATION_PREFERENCES.streak_enabled,
          planUpdatesEnabled: DEFAULT_NOTIFICATION_PREFERENCES.plan_updates_enabled,
          guardianUpdatesEnabled: DEFAULT_NOTIFICATION_PREFERENCES.guardian_updates_enabled,
          marketingEnabled: DEFAULT_NOTIFICATION_PREFERENCES.marketing_enabled,
          digestFrequency: DEFAULT_NOTIFICATION_PREFERENCES.digest_frequency,
          quietHours: DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours,
          updatedAt: null,
        },
      });
    }

    return res.json({ preferences: normalizePreferences(data as Record<string, any>) });
  } catch (error) {
    logger.error("NOTIFICATIONS", "get_preferences_error", "Failed to fetch notification preferences", error);
    res.status(500).json({ error: "Failed to fetch notification preferences" });
  }
});

/**
 * PATCH /api/notifications/preferences
 * Updates persisted notification preferences for the current user.
 */
router.patch("/preferences", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const nowIso = new Date().toISOString();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {
      user_id: userId,
      updated_at: nowIso,
    };

    const boolFields: Array<[string, string]> = [
      ["emailEnabled", "email_enabled"],
      ["studyRemindersEnabled", "study_reminders_enabled"],
      ["streakEnabled", "streak_enabled"],
      ["planUpdatesEnabled", "plan_updates_enabled"],
      ["guardianUpdatesEnabled", "guardian_updates_enabled"],
      ["marketingEnabled", "marketing_enabled"],
    ];

    for (const [inputKey, column] of boolFields) {
      if (typeof body[inputKey] === "boolean") {
        updates[column] = body[inputKey];
      }
    }

    if (typeof body.digestFrequency === "string") {
      updates.digest_frequency = normalizeDigestFrequency(body.digestFrequency);
    }

    if (body.quietHours !== undefined) {
      updates.quiet_hours = normalizeQuietHours(body.quietHours);
    }

    if (Object.keys(updates).length <= 2) {
      return res.status(400).json({ error: "No notification preference fields provided" });
    }

    const { error } = await supabaseServer
      .from("user_notification_preferences")
      .upsert(updates, { onConflict: "user_id" });

    if (error) {
      logger.error("NOTIFICATIONS", "update_preferences_error", "Failed to update notification preferences", error);
      return res.status(500).json({ error: "Failed to update notification preferences" });
    }

    const { data: persisted, error: readError } = await supabaseServer
      .from("user_notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (readError || !persisted) {
      logger.error("NOTIFICATIONS", "update_preferences_error", "Failed to read notification preferences after update", readError);
      return res.status(500).json({ error: "Failed to update notification preferences" });
    }

    return res.json({ preferences: normalizePreferences(persisted as Record<string, any>) });
  } catch (error) {
    logger.error("NOTIFICATIONS", "update_preferences_error", "Failed to update notification preferences", error);
    res.status(500).json({ error: "Failed to update notification preferences" });
  }
});

export default router;
