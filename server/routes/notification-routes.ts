import { Router, Request, Response } from 'express';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { logger } from '../logger.js';
import { requireSupabaseAuth } from '../middleware/supabase-auth.js';
import { csrfGuard } from '../middleware/csrf.js';

const router = Router();

const csrfProtection = csrfGuard();

/**
 * GET /api/notifications
 * Get notifications for the current user (includes system-wide notifications)
 * For user-specific notifications, uses is_read column directly.
 * For system-wide notifications, uses notification_reads table for per-user read status.
 */
router.get('/', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // Get user-specific notifications
    const { data: userNotifs, error: userError } = await supabaseServer
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userError) {
      logger.error('NOTIFICATIONS', 'get_user_notifications_error', 'Failed to fetch user notifications', userError);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    // Get system-wide notifications (user_id is null)
    const { data: systemNotifs, error: systemError } = await supabaseServer
      .from('notifications')
      .select('*')
      .is('user_id', null)
      .or('expires_at.is.null,expires_at.gte.' + new Date().toISOString())
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (systemError) {
      logger.error('NOTIFICATIONS', 'get_system_notifications_error', 'Failed to fetch system notifications', systemError);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    // Get read status for system notifications
    const systemNotifIds = (systemNotifs || []).map(n => n.id);
    let readNotifIds: string[] = [];
    
    if (systemNotifIds.length > 0) {
      const { data: reads } = await supabaseServer
        .from('notification_reads')
        .select('notification_id')
        .eq('user_id', userId)
        .in('notification_id', systemNotifIds);
      
      readNotifIds = (reads || []).map(r => r.notification_id);
    }

    // Combine and format notifications
    const userNotifications = (userNotifs || []).map(n => ({
      id: n.id,
      userId: n.user_id,
      type: n.type,
      category: n.category,
      title: n.title,
      message: n.message,
      priority: n.priority,
      isRead: n.is_read,
      actionUrl: n.action_url,
      actionText: n.action_text,
      metadata: n.metadata,
      expiresAt: n.expires_at,
      createdAt: n.created_at,
    }));

    const systemNotifications = (systemNotifs || []).map(n => ({
      id: n.id,
      userId: n.user_id,
      type: n.type,
      category: n.category,
      title: n.title,
      message: n.message,
      priority: n.priority,
      isRead: readNotifIds.includes(n.id),
      actionUrl: n.action_url,
      actionText: n.action_text,
      metadata: n.metadata,
      expiresAt: n.expires_at,
      createdAt: n.created_at,
    }));

    // Merge and sort by createdAt
    const allNotifications = [...userNotifications, ...systemNotifications]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    res.json(allNotifications);
  } catch (error) {
    logger.error('NOTIFICATIONS', 'get_notifications_error', 'Failed to fetch notifications', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get count of unread notifications for the current user
 * User-specific: uses is_read column. System-wide: checks notification_reads table.
 */
router.get('/unread-count', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Count unread user-specific notifications
    const { count: userUnread, error: userError } = await supabaseServer
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (userError) {
      logger.error('NOTIFICATIONS', 'get_unread_count_error', 'Failed to fetch user unread count', userError);
      return res.status(500).json({ error: 'Failed to fetch unread count' });
    }

    // Get system-wide notifications
    const { data: systemNotifs, error: systemError } = await supabaseServer
      .from('notifications')
      .select('id')
      .is('user_id', null)
      .or('expires_at.is.null,expires_at.gte.' + new Date().toISOString());

    if (systemError) {
      logger.error('NOTIFICATIONS', 'get_system_notifications_error', 'Failed to fetch system notifications', systemError);
      return res.status(500).json({ error: 'Failed to fetch unread count' });
    }

    // Get which system notifications user has read
    const systemNotifIds = (systemNotifs || []).map(n => n.id);
    let unreadSystemCount = 0;
    
    if (systemNotifIds.length > 0) {
      const { data: reads } = await supabaseServer
        .from('notification_reads')
        .select('notification_id')
        .eq('user_id', userId)
        .in('notification_id', systemNotifIds);
      
      const readIds = new Set((reads || []).map(r => r.notification_id));
      unreadSystemCount = systemNotifIds.filter(id => !readIds.has(id)).length;
    }

    res.json({ count: (userUnread || 0) + unreadSystemCount });
  } catch (error) {
    logger.error('NOTIFICATIONS', 'get_unread_count_error', 'Failed to fetch unread count', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a specific notification as read
 * User-specific: updates is_read column. System-wide: inserts into notification_reads.
 */
router.patch('/:id/read', csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const notificationId = req.params.id;

    // Get notification to check if user-specific or system-wide
    const { data: notification, error: fetchError } = await supabaseServer
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .single();

    if (fetchError || !notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    if (notification.user_id && notification.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to modify this notification' });
    }

    if (notification.user_id) {
      // User-specific notification - update is_read
      const { error: updateError } = await supabaseServer
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
      
      if (updateError) {
        throw updateError;
      }
    } else {
      // System-wide notification - insert read record
      const { error: insertError } = await supabaseServer
        .from('notification_reads')
        .upsert({
          user_id: userId,
          notification_id: notificationId,
        }, { onConflict: 'user_id,notification_id' });
      
      if (insertError) {
        throw insertError;
      }
    }

    logger.info('NOTIFICATIONS', 'notification_read', 'Notification marked as read', {
      userId,
      notificationId,
      isSystemWide: !notification.user_id
    });

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    logger.error('NOTIFICATIONS', 'mark_read_error', 'Failed to mark notification as read', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

/**
 * PATCH /api/notifications/mark-all-read
 * Mark all notifications as read for the current user
 * User-specific: updates is_read column. System-wide: inserts into notification_reads.
 */
router.patch('/mark-all-read', csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Mark all user-specific notifications as read
    const { error: userError } = await supabaseServer
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (userError) {
      throw userError;
    }

    // Get unread system-wide notifications for this user
    const { data: systemNotifs } = await supabaseServer
      .from('notifications')
      .select('id')
      .is('user_id', null)
      .or('expires_at.is.null,expires_at.gte.' + new Date().toISOString());

    if (systemNotifs && systemNotifs.length > 0) {
      // Get which ones user has already read
      const systemNotifIds = systemNotifs.map(n => n.id);
      const { data: existingReads } = await supabaseServer
        .from('notification_reads')
        .select('notification_id')
        .eq('user_id', userId)
        .in('notification_id', systemNotifIds);
      
      const readIds = new Set((existingReads || []).map(r => r.notification_id));
      const unreadIds = systemNotifIds.filter(id => !readIds.has(id));
      
      // Insert read records for unread system notifications
      if (unreadIds.length > 0) {
        const { error: insertError } = await supabaseServer
          .from('notification_reads')
          .upsert(
            unreadIds.map(notificationId => ({
              user_id: userId,
              notification_id: notificationId,
            })),
            { onConflict: 'user_id,notification_id' }
          );
        
        if (insertError) {
          throw insertError;
        }
      }

      logger.info('NOTIFICATIONS', 'all_notifications_read', 'All notifications marked as read', {
        userId,
        systemNotificationsMarked: unreadIds.length
      });
    }

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    logger.error('NOTIFICATIONS', 'mark_all_read_error', 'Failed to mark all notifications as read', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

export default router;
