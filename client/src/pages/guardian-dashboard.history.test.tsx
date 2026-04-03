// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GuardianDashboard from './guardian-dashboard';

vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useSupabaseAuth: () => ({
    isGuardian: true,
    isAuthenticated: true,
    authLoading: false,
  }),
}));

vi.mock('@/components/guardian/SubscriptionPaywall', () => ({
  SubscriptionPaywall: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ManageSubscriptionButton: () => <button type="button">Manage Subscription</button>,
}));

vi.mock('wouter', async () => {
  const actual = await vi.importActual<typeof import('wouter')>('wouter');
  return {
    ...actual,
    Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('GuardianDashboard full-length history view UX', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows report action only when runtime view marks reportAvailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = asUrl(input);

      if (url === '/api/guardian/students') {
        return jsonResponse({
          students: [
            {
              id: 'student-1',
              email: 'alex@example.com',
              display_name: 'Alex Student',
              created_at: '2026-03-20T12:00:00.000Z',
            },
          ],
        });
      }

      if (url === '/api/billing/status') {
        return jsonResponse({
          isPaid: true,
          effectiveAccess: true,
          hasLinkedStudent: true,
          linkRequiredForPremium: false,
        });
      }

      if (url === '/api/guardian/students/student-1/summary') {
        return jsonResponse({
          student: { id: 'student-1', displayName: 'Alex Student' },
          progress: {
            practiceMinutesLast7Days: 120,
            sessionsLast7Days: 5,
            questionsAttempted: 80,
            accuracy: 75,
          },
          metrics: [],
        });
      }

      if (url.startsWith('/api/guardian/weaknesses/student-1')) {
        return jsonResponse({
          ok: true,
          count: 0,
          skills: [],
        });
      }

      if (url === '/api/guardian/students/student-1/exams/full-length/sessions?limit=12&include_incomplete=true') {
        return jsonResponse({
          studentId: 'student-1',
          sessions: [
            {
              sessionId: 'sess-complete-1',
              status: 'completed',
              startedAt: '2026-03-20T09:00:00.000Z',
              completedAt: '2026-03-20T11:00:00.000Z',
              createdAt: '2026-03-20T08:58:00.000Z',
              reportAvailable: true,
              reviewAvailable: false,
            },
            {
              sessionId: 'sess-live-2',
              status: 'in_progress',
              startedAt: '2026-03-21T09:00:00.000Z',
              completedAt: null,
              createdAt: '2026-03-21T08:58:00.000Z',
              reportAvailable: false,
              reviewAvailable: false,
            },
          ],
        });
      }

      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    render(<GuardianDashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Alex Student')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Alex Student'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Report' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Report Locked' })).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'Open Report' })).not.toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Report Locked' })).toHaveProperty('disabled', true);

    const urls = fetchMock.mock.calls.map(([input]) => asUrl(input));
    expect(urls).toContain('/api/guardian/students/student-1/exams/full-length/sessions?limit=12&include_incomplete=true');
  });
});
