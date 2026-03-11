import request from 'supertest';
import app from '../server/index';
import { describe, it, expect } from 'vitest';

describe('Legacy Questions Validate Path Quarantine', () => {
  it('returns 404 for unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/questions/validate')
      .set('Origin', 'http://localhost:5000')
      .send({ questionId: 'q1', studentAnswer: 'B' });

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('explanation');
    expect(res.body).not.toHaveProperty('correct_answer');
    expect(res.body).not.toHaveProperty('answer_text');
  });

  it('returns 404 even with bearer auth', async () => {
    const res = await request(app)
      .post('/api/questions/validate')
      .set('Authorization', 'Bearer fake-token')
      .set('Origin', 'http://localhost:5000')
      .send({ questionId: 'q1', studentAnswer: 'B' });

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('explanation');
  });
});

