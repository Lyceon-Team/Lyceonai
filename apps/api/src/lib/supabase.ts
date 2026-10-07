import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../../../server/logger';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // In test mode, return placeholder client if env vars missing
    const isTestEnv = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

    if (!supabaseUrl || !supabaseKey) {
      if (isTestEnv) {
        logger.info('SUPABASE', 'init', 'Test mode: using placeholder client');
        supabaseClient = createClient('https://placeholder.supabase.co', 'placeholder-key', {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
        return supabaseClient;
      }

      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    logger.info('SUPABASE', 'init', 'Supabase client initialized');
  }

  return supabaseClient;
}

const VECTOR_SETUP_HINT = 'Run the SQL setup script: database/supabase-vector-setup.sql';

// Initialize Supabase vector table if needed
// NOTE: This function checks if the table exists. If not, you need to manually create it
// using the SQL script in database/supabase-vector-setup.sql
export async function initializeVectorTable(): Promise<void> {
  const supabase = getSupabaseClient();

  try {
    // Check if question_embeddings table exists
    const { error } = await supabase
      .from('question_embeddings')
      .select('id')
      .limit(1);

    if (error && error.code === '42P01') {
      // Table doesn't exist
      logger.warn(
        'SUPABASE',
        'vector_table_check',
        'question_embeddings table does not exist in Supabase; vector search unavailable until it is created',
        { hint: VECTOR_SETUP_HINT },
      );
    } else if (!error) {
      logger.info('SUPABASE', 'vector_table_check', 'question_embeddings table exists');

      // Check if match_questions function exists by trying to call it
      const { error: funcError } = await supabase.rpc('match_questions', {
        query_embedding: Array(1536).fill(0),
        match_threshold: 0.7,
        match_count: 1,
      });

      if (funcError && funcError.message.includes('function')) {
        logger.warn(
          'SUPABASE',
          'vector_function_check',
          'match_questions() function does not exist',
          { hint: VECTOR_SETUP_HINT },
        );
      } else {
        logger.info('SUPABASE', 'vector_function_check', 'match_questions() function is available');
      }
    } else {
      logger.warn('SUPABASE', 'vector_table_check', 'Error checking vector table', {
        errorMessage: error.message,
      });
    }
  } catch (err) {
    logger.warn('SUPABASE', 'vector_table_check', 'Vector table initialization check failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface QuestionEmbedding {
  id: string;
  question_id: string;
  embedding: number[];
  stem: string;
  section: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

// Store question embedding in Supabase
export async function storeQuestionEmbedding(
  questionId: string,
  embedding: number[],
  stem: string,
  section: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('question_embeddings')
    .upsert({
      id: questionId,
      question_id: questionId,
      embedding,
      stem,
      section,
      metadata,
    }, {
      onConflict: 'question_id'
    });

  if (error) {
    logger.error('SUPABASE', 'store_embedding', 'Error storing question embedding', error);
    throw new Error(`Failed to store embedding: ${error.message}`);
  }
}

// Search for similar questions using vector similarity
export async function searchSimilarQuestions(
  queryEmbedding: number[],
  limit: number = 10,
  section?: string
): Promise<Array<QuestionEmbedding & { similarity: number }>> {
  const supabase = getSupabaseClient();
  const isTestEnv = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

  try {
    // Use Supabase's RPC for vector similarity search
    let query = supabase.rpc('match_questions', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: limit,
    });

    if (section) {
      query = query.eq('section', section);
    }

    const { data, error } = await query;

    if (error) {
      if (!isTestEnv) logger.error('SUPABASE', 'vector_search', 'Vector search error', error);
      throw new Error(`Vector search failed: ${error.message}`);
    }

    return data || [];
  } catch (err) {
    if (!isTestEnv) logger.error('SUPABASE', 'vector_search', 'Search similar questions error', err);
    return [];
  }
}
