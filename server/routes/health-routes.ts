import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../logger.js';
import { getSupabaseAdmin, resolveTokenFromRequest } from '../middleware/supabase-auth.js';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

interface SchemaCheck {
  hasColumns: string[];
  missingColumns: string[];
}

interface HealthReport {
  ok: boolean;
  timestamp: string;
  env: {
    supabaseUrlSet: boolean;
    serviceKeySet: boolean;
    anonKeySet: boolean;
  };
  auth: {
    resolvedUserId: string | null;
    tokenSource: string | null;
    serviceRoleCanReadUser: boolean | null;
    userLookupError: string | null;
  };
  schema: {
    questions: SchemaCheck;
    practice_sessions: SchemaCheck;
    answer_attempts: SchemaCheck;
    practice_events: SchemaCheck;
  };
}

router.get('/practice', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  
  const report: HealthReport = {
    ok: true,
    timestamp: new Date().toISOString(),
    env: {
      supabaseUrlSet: !!process.env.SUPABASE_URL,
      serviceKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      anonKeySet: !!process.env.SUPABASE_ANON_KEY,
    },
    auth: {
      resolvedUserId: null,
      tokenSource: null,
      serviceRoleCanReadUser: null,
      userLookupError: null,
    },
    schema: {
      questions: { hasColumns: [], missingColumns: [] },
      practice_sessions: { hasColumns: [], missingColumns: [] },
      answer_attempts: { hasColumns: [], missingColumns: [] },
      practice_events: { hasColumns: [], missingColumns: [] },
    },
  };

  try {
    // Use SHARED helper for token resolution (same as practice endpoints)
    const tokenResult = resolveTokenFromRequest(req);
    report.auth.tokenSource = tokenResult.tokenSource;

    if (tokenResult.token) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: { user }, error } = await supabase.auth.getUser(tokenResult.token);
        if (!error && user) {
          report.auth.resolvedUserId = user.id;

          const admin = getSupabaseAdmin();
          const { data, error: adminErr } = await admin.auth.admin.getUserById(user.id);
          
          if (adminErr || !data?.user) {
            report.auth.serviceRoleCanReadUser = false;
            report.auth.userLookupError = adminErr?.message || 'user_not_found';
            report.ok = false;
          } else {
            report.auth.serviceRoleCanReadUser = true;
          }
        }
      } catch (e: any) {
        report.auth.userLookupError = e?.message || 'exception';
      }
    }

    const admin = getSupabaseAdmin();

    const requiredColumns: Record<string, string[]> = {
      questions: ['id', 'canonical_id', 'status', 'section', 'section_code', 'question_type', 'stem', 'options', 'correct_answer', 'answer_text', 'explanation', 'option_metadata', 'domain', 'skill', 'subskill', 'skill_code', 'difficulty', 'source_type'],
      practice_sessions: ['id', 'user_id', 'section', 'status', 'started_at'],
      answer_attempts: ['id', 'user_id', 'session_id', 'question_id', 'selected_answer', 'is_correct', 'attempted_at'],
      practice_events: ['id', 'user_id', 'event_type', 'created_at'],
    };

    for (const [tableName, columns] of Object.entries(requiredColumns)) {
      const tableCheck = report.schema[tableName as keyof typeof report.schema];
      
      // Use information_schema to check column existence (more reliable)
      const { data: schemaRows, error: schemaErr } = await admin
        .from('information_schema.columns' as any)
        .select('column_name')
        .eq('table_schema', 'public')
        .eq('table_name', tableName);
      
      if (schemaErr) {
        // Fallback: try select approach if information_schema fails
        const selectStr = columns.join(', ');
        const { error: selectErr } = await admin
          .from(tableName)
          .select(selectStr)
          .limit(0);
        
        if (selectErr) {
          const missingMatch = selectErr.message?.match(/column.*"(\w+)".*does not exist/i);
          if (missingMatch) {
            tableCheck.missingColumns = [missingMatch[1]];
            tableCheck.hasColumns = columns.filter(c => c !== missingMatch[1]);
            report.ok = false;
          } else if (selectErr.message?.includes('does not exist')) {
            tableCheck.missingColumns = ['(table_not_found)'];
            report.ok = false;
          } else {
            tableCheck.hasColumns = columns;
            tableCheck.missingColumns = [];
          }
        } else {
          tableCheck.hasColumns = columns;
          tableCheck.missingColumns = [];
        }
      } else {
        const existingCols = new Set((schemaRows || []).map((r: any) => r.column_name));
        tableCheck.hasColumns = columns.filter(c => existingCols.has(c));
        tableCheck.missingColumns = columns.filter(c => !existingCols.has(c));
        if (tableCheck.missingColumns.length > 0) {
          report.ok = false;
        }
      }
    }

    if (!report.env.supabaseUrlSet || !report.env.serviceKeySet) {
      report.ok = false;
    }

    res.json(report);
  } catch (error: any) {
    logger.error('HEALTH', 'practice', 'Health check failed', { error: error?.message });
    report.ok = false;
    res.status(500).json({ ...report, error: error?.message || 'Health check failed' });
  }
});

export default router;

