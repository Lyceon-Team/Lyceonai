# Client Routes (React/Wouter)

## Router definition
- Client routing is defined in `client/src/App.tsx` using Wouter `<Switch>` and `<Route>` entries. Evidence: `client/src/App.tsx` lines 55-120.【client/src/App.tsx:L55-L120】

## Route table

| Path | Component | Redirect? | Guard / Gate | Evidence |
|---|---|---|---|---|
| `/` | `HomePage` | No | None | `client/src/App.tsx` lines 60-66.【client/src/App.tsx:L60-L66】 |
| `/login` | `Login` | No | None | `client/src/App.tsx` line 61.【client/src/App.tsx:L60-L66】 |
| `/digital-sat` | `DigitalSAT` | No | None | `client/src/App.tsx` lines 67-70.【client/src/App.tsx:L67-L70】 |
| `/digital-sat/math` | `DigitalSATMath` | No | None | `client/src/App.tsx` line 68.【client/src/App.tsx:L67-L70】 |
| `/digital-sat/reading-writing` | `DigitalSATReadingWriting` | No | None | `client/src/App.tsx` line 69.【client/src/App.tsx:L67-L70】 |
| `/blog` | `Blog` | No | None | `client/src/App.tsx` line 70.【client/src/App.tsx:L67-L71】 |
| `/blog/:slug` | `BlogPost` | No | None | `client/src/App.tsx` line 71.【client/src/App.tsx:L70-L71】 |
| `/legal` | `LegalHub` | No | None | `client/src/App.tsx` line 74.【client/src/App.tsx:L73-L75】 |
| `/legal/:slug` | `LegalDoc` | No | None | `client/src/App.tsx` line 75.【client/src/App.tsx:L73-L76】 |
| `/privacy` | Redirect to `/legal/privacy-policy` | Yes | None | `client/src/App.tsx` line 78.【client/src/App.tsx:L77-L79】 |
| `/terms` | Redirect to `/legal/student-terms` | Yes | None | `client/src/App.tsx` line 79.【client/src/App.tsx:L78-L80】 |
| `/dashboard` | `LyceonDashboard` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 82 and `client/src/components/auth/RequireRole.tsx` lines 13-47.【client/src/App.tsx:L81-L84】【client/src/components/auth/RequireRole.tsx:L13-L47】 |
| `/calendar` | `CalendarPage` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 83.【client/src/App.tsx:L82-L84】 |
| `/chat` | `Chat` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 84.【client/src/App.tsx:L83-L85】 |
| `/full-test` | `FullTest` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 85.【client/src/App.tsx:L84-L86】 |
| `/practice` | `Practice` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 86.【client/src/App.tsx:L85-L87】 |
| `/practice/math` | `MathPractice` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 87.【client/src/App.tsx:L86-L88】 |
| `/practice/reading-writing` | `ReadingWritingPractice` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 88.【client/src/App.tsx:L87-L89】 |
| `/practice/random` | `RandomPractice` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 89.【client/src/App.tsx:L88-L90】 |
| `/math-practice` | `MathPractice` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 90.【client/src/App.tsx:L89-L91】 |
| `/reading-writing-practice` | `ReadingWritingPractice` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 91.【client/src/App.tsx:L90-L92】 |
| `/mastery` | `MasteryPage` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 92.【client/src/App.tsx:L91-L93】 |
| `/review-errors` | `ReviewErrors` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 93.【client/src/App.tsx:L92-L94】 |
| `/flow-cards` | `FlowCards` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 94.【client/src/App.tsx:L93-L95】 |
| `/structured-practice` | `StructuredPractice` | No | `RequireRole` allow `student, admin` | `client/src/App.tsx` line 95.【client/src/App.tsx:L94-L96】 |
| `/profile` | `UserProfile` | No | `RequireRole` allow `student, guardian, admin` | `client/src/App.tsx` line 98.【client/src/App.tsx:L97-L99】 |
| `/profile/complete` | `ProfileComplete` | No | `RequireRole` allow `student, guardian, admin` | `client/src/App.tsx` line 99.【client/src/App.tsx:L98-L100】 |
| `/guardian` | `GuardianDashboard` | No | `RequireRole` allow `guardian, admin` | `client/src/App.tsx` line 102.【client/src/App.tsx:L101-L103】 |
| `/guardian/students/:studentId/calendar` | `GuardianCalendar` | No | `RequireRole` allow `guardian, admin` | `client/src/App.tsx` line 103.【client/src/App.tsx:L102-L104】 |
| `/admin` | `AdminPortal` | No | `AdminGuard` inside component | `client/src/App.tsx` line 106 and `client/src/pages/AdminPortal.tsx` lines 22-36.【client/src/App.tsx:L105-L107】【client/src/pages/AdminPortal.tsx:L22-L36】 |
| `/admin-dashboard` | Redirect to `/admin` | Yes | None | `client/src/App.tsx` line 109.【client/src/App.tsx:L108-L110】 |
| `/admin-system-config` | Redirect to `/admin` | Yes | None | `client/src/App.tsx` line 111.【client/src/App.tsx:L110-L112】 |
| `/admin-questions` | Redirect to `/admin` | Yes | None | `client/src/App.tsx` line 112.【client/src/App.tsx:L111-L113】 |
| `/admin-review` | Redirect to `/admin` | Yes | None | `client/src/App.tsx` line 113.【client/src/App.tsx:L112-L114】 |
| `/admin-portal` | Redirect to `/admin` | Yes | None | `client/src/App.tsx` line 115.【client/src/App.tsx:L114-L116】 |
| `/admin-review-v2` | Redirect to `/admin` | Yes | None | `client/src/App.tsx` line 117.【client/src/App.tsx:L116-L118】 |
| `*` | `NotFound` | No | None | `client/src/App.tsx` lines 119-120.【client/src/App.tsx:L119-L120】 |

## DEPRECATED Routes (Removed in Sprint 2)

The following ingestion-related routes have been **REMOVED** as part of Sprint 2 "Kill ingestion surfaces":

| Path | Previous Behavior | Status | Removal Date |
|---|---|---|---|
| `/admin-pdf-monitor` | Redirected to `/admin` | ❌ REMOVED | 2026-02-02 |
| `/admin-ingest-jobs` | Redirected to `/admin` | ❌ REMOVED | 2026-02-02 |
| `/admin-ingest` | Redirected to `/admin` | ❌ REMOVED | 2026-02-02 |

## Guards and redirects
- `RequireRole` enforces role-based access and redirects to `/login`, `/guardian`, `/admin`, or `/dashboard` based on role. Evidence: `client/src/components/auth/RequireRole.tsx` lines 13-57.【client/src/components/auth/RequireRole.tsx:L13-L57】
- `AdminGuard` enforces admin-only access within `AdminPortal` (renders access denied prompt if not admin). Evidence: `client/src/components/auth/AdminGuard.tsx` lines 6-78.【client/src/components/auth/AdminGuard.tsx:L6-L78】

## Dark routes (pages present but not reachable via router)
- `client/src/pages/dashboard.tsx` defines a `Dashboard` page, but `client/src/App.tsx` routes `/dashboard` to `LyceonDashboard` and does not import `Dashboard`. Evidence: `client/src/pages/dashboard.tsx` lines 1-80 and `client/src/App.tsx` lines 82-84.【client/src/pages/dashboard.tsx:L1-L80】【client/src/App.tsx:L82-L84】
