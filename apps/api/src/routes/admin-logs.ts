import { Request, Response } from 'express';
import { supabaseServer } from '../lib/supabase-server';

// GET /api/admin/logs - Get comprehensive system logs including ingestion history, errors, and practice activity
export const getAdminLogs = async (req: Request, res: Response) => {
  try {
    const { 
      type = 'all', // 'all', 'ingestion', 'practice', 'system', 'audit'
      limit = 100,
      offset = 0,
      level, // 'debug', 'info', 'warning', 'error', 'critical' (for system logs)
      status, // Filter by status (for ingestion logs)
      from, // ISO timestamp for date range filtering
      to, // ISO timestamp for date range filtering
    } = req.query;

    const numLimit = Math.min(parseInt(limit as string) || 100, 500);
    const numOffset = parseInt(offset as string) || 0;

    const response: any = {
      type,
      limit: numLimit,
      offset: numOffset,
      filters: { level, status, from, to },
      data: {},
    };

    // Helper to parse date range
    const fromDate = from ? new Date(from as string).toISOString() : undefined;
    const toDate = to ? new Date(to as string).toISOString() : undefined;

    // Fetch ingestion logs (ingestion_runs table)
    if (type === 'all' || type === 'ingestion') {
      let query = supabaseServer.from('ingestion_runs').select('*');
      
      if (status) {
        query = query.eq('status', status as string);
      }
      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }
      if (toDate) {
        query = query.lte('created_at', toDate);
      }
      
      const { data: jobs, error: jobsError } = await query
        .order('created_at', { ascending: false })
        .range(numOffset, numOffset + numLimit - 1);

      if (jobsError) {
        console.error('[ADMIN_LOGS] Error fetching ingestion runs:', jobsError);
      }

      response.data.ingestion = {
        jobs: jobs || [],
        summary: {
          totalJobs: jobs?.length || 0,
          running: jobs?.filter(j => j.status === 'running').length || 0,
          completed: jobs?.filter(j => j.status === 'completed').length || 0,
          failed: jobs?.filter(j => j.status === 'failed').length || 0,
        },
      };
    }

    // Fetch practice activity logs
    if (type === 'all' || type === 'practice') {
      let query = supabaseServer.from('practice_sessions').select('*');
      
      if (status) {
        query = query.eq('status', status as string);
      }
      if (fromDate) {
        query = query.gte('started_at', fromDate);
      }
      if (toDate) {
        query = query.lte('started_at', toDate);
      }
      
      const { data: sessions, error: sessionsError } = await query
        .order('started_at', { ascending: false })
        .range(numOffset, numOffset + numLimit - 1);

      if (sessionsError) {
        console.error('[ADMIN_LOGS] Error fetching practice sessions:', sessionsError);
      }

      // Get user info and answer attempts for each session
      const sessionsWithDetails = await Promise.all(
        (sessions || []).map(async (session) => {
          // Get user info
          const { data: user } = await supabaseServer
            .from('profiles')
            .select('id, email, display_name')
            .eq('id', session.user_id)
            .single();

          // Get answer attempts
          const { data: attempts } = await supabaseServer
            .from('answer_attempts')
            .select('*')
            .eq('session_id', session.id)
            .order('attempted_at', { ascending: false })
            .limit(100);

          const correctCount = attempts?.filter(a => a.is_correct).length || 0;
          const totalCount = attempts?.length || 0;

          return {
            ...session,
            user: user || null,
            attempts: (attempts || []).slice(0, 20),
            stats: {
              totalAttempts: totalCount,
              correctAttempts: correctCount,
              accuracy: totalCount > 0 ? (correctCount / totalCount) * 100 : 0,
            },
          };
        })
      );

      response.data.practice = {
        sessions: sessionsWithDetails,
        summary: {
          totalSessions: sessions?.length || 0,
          inProgress: sessions?.filter(s => s.status === 'in_progress').length || 0,
          completed: sessions?.filter(s => s.status === 'completed').length || 0,
          abandoned: sessions?.filter(s => s.status === 'abandoned').length || 0,
        },
      };
    }

    // Fetch system event logs
    if (type === 'all' || type === 'system') {
      let query = supabaseServer.from('system_event_logs').select('*');
      
      if (level) {
        query = query.eq('level', level as string);
      }
      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }
      if (toDate) {
        query = query.lte('created_at', toDate);
      }
      
      const { data: systemLogs, error: logsError } = await query
        .order('created_at', { ascending: false })
        .range(numOffset, numOffset + numLimit - 1);

      if (logsError) {
        console.error('[ADMIN_LOGS] Error fetching system logs:', logsError);
      }

      response.data.system = {
        logs: systemLogs || [],
        summary: {
          total: systemLogs?.length || 0,
          errors: systemLogs?.filter(l => l.level === 'error' || l.level === 'critical').length || 0,
          warnings: systemLogs?.filter(l => l.level === 'warning').length || 0,
        },
      };
    }

    // Fetch admin audit logs
    if (type === 'all' || type === 'audit') {
      let query = supabaseServer.from('admin_audit_logs').select('*');
      
      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }
      if (toDate) {
        query = query.lte('created_at', toDate);
      }
      
      const { data: auditLogs, error: auditError } = await query
        .order('created_at', { ascending: false })
        .range(numOffset, numOffset + numLimit - 1);

      if (auditError) {
        console.error('[ADMIN_LOGS] Error fetching audit logs:', auditError);
      }

      // Get admin user info for each audit log
      const logsWithAdmin = await Promise.all(
        (auditLogs || []).map(async (log) => {
          const { data: admin } = await supabaseServer
            .from('profiles')
            .select('id, email, display_name')
            .eq('id', log.admin_user_id)
            .single();

          return {
            log,
            admin: admin || null,
          };
        })
      );

      response.data.audit = {
        logs: logsWithAdmin,
        summary: {
          total: auditLogs?.length || 0,
          failed: auditLogs?.filter(l => !l.success).length || 0,
        },
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching admin logs:', error);
    res.status(500).json({ 
      error: 'Failed to fetch admin logs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// GET /api/admin/logs/summary - Get a quick summary dashboard of system health
export const getLogsSummary = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Get counts from various tables in parallel
    const [
      totalIngestionRunsResult,
      runningIngestionRunsResult,
      recentErrorsResult,
      activePracticeSessionsResult,
      totalPracticeSessions24hResult,
      recentJobsResult,
      recentSystemErrorsResult,
    ] = await Promise.all([
      supabaseServer.from('ingestion_runs').select('*', { count: 'exact', head: true }),
      supabaseServer.from('ingestion_runs').select('*', { count: 'exact', head: true }).eq('status', 'running'),
      supabaseServer.from('system_event_logs').select('*', { count: 'exact', head: true })
        .eq('level', 'error').gte('created_at', yesterday),
      supabaseServer.from('practice_sessions').select('*', { count: 'exact', head: true })
        .eq('status', 'in_progress'),
      supabaseServer.from('practice_sessions').select('*', { count: 'exact', head: true })
        .gte('started_at', yesterday),
      supabaseServer.from('ingestion_runs').select('*').order('created_at', { ascending: false }).limit(5),
      supabaseServer.from('system_event_logs').select('*')
        .eq('level', 'error').order('created_at', { ascending: false }).limit(10),
    ]);

    res.json({
      summary: {
        ingestionRuns: {
          total: totalIngestionRunsResult.count || 0,
          running: runningIngestionRunsResult.count || 0,
        },
        errors: {
          last24h: recentErrorsResult.count || 0,
        },
        practice: {
          activeNow: activePracticeSessionsResult.count || 0,
          last24h: totalPracticeSessions24hResult.count || 0,
        },
      },
      recentJobs: recentJobsResult.data || [],
      recentErrors: recentSystemErrorsResult.data || [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching logs summary:', error);
    res.status(500).json({ 
      error: 'Failed to fetch logs summary',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// POST /api/admin/logs/system - Create a system event log (for internal use)
export const createSystemLog = async (req: Request, res: Response) => {
  try {
    const { eventType, level, source, message, details, documentId, userId, sessionId, duration } = req.body;

    if (!eventType || !source || !message) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: 'eventType, source, and message are required'
      });
    }

    const insertData: any = {
      event_type: eventType,
      level: level || 'info',
      source,
      message,
    };

    if (details !== undefined && details !== null) {
      insertData.details = details;
    }
    if (documentId) {
      insertData.document_id = documentId;
    }
    if (userId) {
      insertData.user_id = userId;
    }
    if (sessionId) {
      insertData.session_id = sessionId;
    }
    if (duration !== undefined) {
      insertData.duration = duration;
    }

    const { data: log, error } = await supabaseServer
      .from('system_event_logs')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[ADMIN_LOGS] Error creating system log:', error);
      return res.status(500).json({ 
        error: 'Failed to create system log',
        detail: error.message
      });
    }

    res.json({ success: true, log });
  } catch (error) {
    console.error('Error creating system log:', error);
    res.status(500).json({ 
      error: 'Failed to create system log',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
