import { supabaseServer } from '../lib/supabase-server';
import { logger } from '../../../../server/logger';

export async function testDbConnection(): Promise<boolean> {
  try {
    const { error } = await supabaseServer.from('questions').select('id', { count: 'exact', head: true });
    return !error;
  } catch (error) {
    logger.error('DB', 'connection_test', 'DB connection test failed', error);
    return false;
  }
}

export const initializeDb = async () => {
  try {
    const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!hasSupabase) {
      logger.warn(
        'DB',
        'initialize',
        'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set - database features will be unavailable',
      );
      return;
    }

    const connected = await testDbConnection();
    if (connected) {
      logger.info('DB', 'initialize', 'Supabase PostgreSQL database connected; initialization completed');
    } else {
      logger.warn('DB', 'initialize', 'Supabase connection check failed');
    }
  } catch (error) {
    logger.error('DB', 'initialize', 'Database initialization failed', error);
    throw error;
  }
};

export const getDbStats = async () => {
  try {
    const questionsResult = await supabaseServer.from('questions').select('id', { count: 'exact', head: true });

    return {
      questions: Number(questionsResult.count ?? 0),
    };
  } catch (error) {
    logger.error('DB', 'stats', 'Error getting database stats', error);
    return { questions: 0 };
  }
};
