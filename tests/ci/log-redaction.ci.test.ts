import { describe, it, expect } from 'vitest';
import { redactSensitive } from '../../server/logger';

describe('redactSensitive', () => {
  it('redacts authorization headers (any casing)', () => {
    const input = { headers: { Authorization: 'Bearer secret', authorization: 'Bearer secret2' } };
    const result = redactSensitive(input);

    expect(result.headers.Authorization).toBe('[REDACTED]');
    expect(result.headers.authorization).toBe('[REDACTED]');
  });

  it('redacts cookie headers (any casing)', () => {
    const input = { headers: { Cookie: 'a=b', cookie: 'x=y' } };
    const result = redactSensitive(input);

    expect(result.headers.Cookie).toBe('[REDACTED]');
    expect(result.headers.cookie).toBe('[REDACTED]');
  });

  it('redacts nested token fields', () => {
    const input = {
      auth: {
        access_token: 'access',
        nested: { refresh_token: 'refresh', deeper: { id_token: 'id', token: 'plain' } }
      }
    };
    const result = redactSensitive(input);

    expect(result.auth.access_token).toBe('[REDACTED]');
    expect(result.auth.nested.refresh_token).toBe('[REDACTED]');
    expect(result.auth.nested.deeper.id_token).toBe('[REDACTED]');
    expect(result.auth.nested.deeper.token).toBe('[REDACTED]');
  });

  it('handles arrays containing sensitive keys', () => {
    const input = [
      { token: 'abc', meta: { Authorization: 'Bearer 123' } },
      { headers: { authorization: 'secret' } }
    ];
    const result = redactSensitive(input);

    expect(result[0].token).toBe('[REDACTED]');
    expect(result[0].meta.Authorization).toBe('[REDACTED]');
    expect(result[1].headers.authorization).toBe('[REDACTED]');
  });

  it('preserves non-sensitive primitives', () => {
    const input = { status: 200, message: 'ok', count: 3, success: true };
    const result = redactSensitive(input);

    expect(result).toEqual(input);
  });
});
