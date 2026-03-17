import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const {
  mockGenerateEmbedding,
  mockSearchSimilarQuestions,
  mockGetSupabaseClient,
} = vi.hoisted(() => ({
  mockGenerateEmbedding: vi.fn(),
  mockSearchSimilarQuestions: vi.fn(),
  mockGetSupabaseClient: vi.fn(),
}));

vi.mock('../../apps/api/src/lib/embeddings', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('../../apps/api/src/lib/supabase', () => ({
  searchSimilarQuestions: mockSearchSimilarQuestions,
  getSupabaseClient: mockGetSupabaseClient,
}));

describe('Public question search rate limiter', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';

    mockGetSupabaseClient.mockReturnValue({});
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockSearchSimilarQuestions.mockResolvedValue([]);

    const serverModule = await import('../../server/index');
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  it('under-limit anonymous request still reaches normal handler behavior', async () => {
    const res = await request(app)
      .get('/api/questions/search?q=algebra')
      .set('X-Forwarded-For', '198.51.100.10');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      results: [],
      total: 0,
      query: 'algebra',
      section: null,
    });
    expect(mockGenerateEmbedding).toHaveBeenCalledWith('algebra');
    expect(mockSearchSimilarQuestions).toHaveBeenCalled();
  });

  it('q required behavior remains unchanged below the limit', async () => {
    const res = await request(app)
      .get('/api/questions/search')
      .set('X-Forwarded-For', '198.51.100.11');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Query parameter "q" is required and must not be empty',
    });
  });

  it('exceeding the limiter returns 429', async () => {
    const limit = 20;
    const ip = '198.51.100.12';

    for (let i = 0; i < limit; i++) {
      const okRes = await request(app)
        .get('/api/questions/search?q=geometry')
        .set('X-Forwarded-For', ip);
      expect(okRes.status).toBe(200);
    }

    const overLimitRes = await request(app)
      .get('/api/questions/search?q=geometry')
      .set('X-Forwarded-For', ip);

    expect(overLimitRes.status).toBe(429);
    expect(overLimitRes.body).toEqual({
      error: 'Too many search requests',
    });
  });

  it('when rate-limited, generateEmbedding and searchSimilarQuestions are not called', async () => {
    const limit = 20;
    const ip = '198.51.100.13';

    mockGenerateEmbedding.mockClear();
    mockSearchSimilarQuestions.mockClear();

    for (let i = 0; i < limit; i++) {
      const okRes = await request(app)
        .get('/api/questions/search?q=geometry')
        .set('X-Forwarded-For', ip);
      expect(okRes.status).toBe(200);
    }

    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(limit);
    expect(mockSearchSimilarQuestions).toHaveBeenCalledTimes(limit);

    const overLimitRes = await request(app)
      .get('/api/questions/search?q=geometry')
      .set('X-Forwarded-For', ip);

    expect(overLimitRes.status).toBe(429);
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(limit);
    expect(mockSearchSimilarQuestions).toHaveBeenCalledTimes(limit);
  });
});
