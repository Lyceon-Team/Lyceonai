import { supabaseServer } from '../lib/supabase-server';

export async function testDbConnection(): Promise<boolean> {
  try {
    const { data, error } = await supabaseServer.from('questions').select('id', { count: 'exact', head: true });
    return !error;
  } catch (error) {
    console.error('DB connection test failed:', error);
    return false;
  }
}

export const initializeDb = async () => {
  try {
    const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!hasSupabase) {
      console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set - database features will be unavailable');
      return;
    }

    const connected = await testDbConnection();
    if (connected) {
      console.log('✅ Supabase PostgreSQL Database connected successfully');
      console.log('ℹ️ Database initialization completed');
    } else {
      console.warn('⚠️ Supabase connection check failed');
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};

export const getDbStats = async () => {
  try {
    const [questionsResult, ingestionRunsResult] = await Promise.all([
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }),
      supabaseServer.from('ingestion_runs').select('id', { count: 'exact', head: true }),
    ]);
    
    return {
      questions: Number(questionsResult.count ?? 0),
      ingestionRuns: Number(ingestionRunsResult.count ?? 0),
    };
  } catch (error) {
    console.error('Error getting database stats:', error);
    return { questions: 0, ingestionRuns: 0 };
  }
};
