import type { Express, Request, Response } from 'express';
import os from 'os';
import { supabaseServer } from '../lib/supabase-server';

export function registerHealthz(app: Express) {
  app.get('/healthz', async (_req: Request, res: Response) => {
    const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    const embeddingsModel = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';
    
    let supabaseReachable = false;
    if (hasSupabase) {
      try {
        const { data, error } = await supabaseServer.from('questions').select('id', { count: 'exact', head: true });
        supabaseReachable = !error;
      } catch (error) {
        console.error('Supabase health check failed:', error);
        supabaseReachable = false;
      }
    }

    res.json({
      ok: true,
      version: '1.0.0',
      nodeEnv: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      hostname: os.hostname(),
      hasSupabase,
      supabaseReachable,
      embeddingsModel,
      nextAuthEnabled: process.env.NEXTAUTH_ENABLED === 'true'
    });
  });
}
