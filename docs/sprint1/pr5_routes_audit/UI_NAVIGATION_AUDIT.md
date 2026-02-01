# UI Navigation Consistency Audit

## Shared layout components
- `AppShell` provides app header/nav and optional footer. Evidence: `client/src/components/layout/app-shell.tsx` lines 17-44.【client/src/components/layout/app-shell.tsx:L17-L44】
- `PublicLayout` wraps public pages with `PublicNavBar` and `Footer`. Evidence: `client/src/components/layout/PublicLayout.tsx` lines 1-18.【client/src/components/layout/PublicLayout.tsx:L1-L18】
- `PracticeShell` provides a sticky header with back button, progress, and score. Evidence: `client/src/components/layout/PracticeShell.tsx` lines 31-89.【client/src/components/layout/PracticeShell.tsx:L31-L89】

## Pages using AppShell
- `/dashboard` (LyceonDashboard): `AppShell` wrapper used. Evidence: `client/src/pages/lyceon-dashboard.tsx` lines 3-151.【client/src/pages/lyceon-dashboard.tsx:L3-L151】
- `/calendar`: `AppShell` wrapper used. Evidence: `client/src/pages/calendar.tsx` lines 217-281.【client/src/pages/calendar.tsx:L217-L281】
- `/chat`: `AppShell` wrapper used. Evidence: `client/src/pages/chat.tsx` lines 2-129.【client/src/pages/chat.tsx:L2-L129】
- `/full-test`: `AppShell` wrapper used. Evidence: `client/src/pages/full-test.tsx` lines 1-118.【client/src/pages/full-test.tsx:L1-L118】
- `/practice`: `AppShell` wrapper used. Evidence: `client/src/pages/practice.tsx` lines 1-100.【client/src/pages/practice.tsx:L1-L100】
- `/mastery`: `AppShell` wrapper used. Evidence: `client/src/pages/mastery.tsx` lines 1-22.【client/src/pages/mastery.tsx:L1-L22】
- `/profile`: `AppShell` wrapper used. Evidence: `client/src/pages/UserProfile.tsx` lines 168-179.【client/src/pages/UserProfile.tsx:L168-L179】

## Pages using PublicLayout
- `/` (HomePage): `PublicLayout` wrapper used. Evidence: `client/src/pages/home.tsx` lines 16-67.【client/src/pages/home.tsx:L16-L67】
- `/blog`: `PublicLayout` wrapper used. Evidence: `client/src/pages/blog.tsx` lines 1-14.【client/src/pages/blog.tsx:L1-L14】
- `/blog/:slug`: `PublicLayout` wrapper used. Evidence: `client/src/pages/blog-post.tsx` lines 1-55.【client/src/pages/blog-post.tsx:L1-L55】
- `/digital-sat`: `PublicLayout` wrapper used. Evidence: `client/src/pages/digital-sat.tsx` lines 1-37.【client/src/pages/digital-sat.tsx:L1-L37】
- `/digital-sat/math`: `PublicLayout` wrapper used. Evidence: `client/src/pages/digital-sat-math.tsx` lines 1-44.【client/src/pages/digital-sat-math.tsx:L1-L44】
- `/digital-sat/reading-writing`: `PublicLayout` wrapper used. Evidence: `client/src/pages/digital-sat-reading-writing.tsx` lines 1-44.【client/src/pages/digital-sat-reading-writing.tsx:L1-L44】

## PracticeShell usage
- Practice question flows rendered by `CanonicalPracticePage` use `PracticeShell` with `backLabel` and `backLink`. Evidence: `client/src/components/practice/CanonicalPracticePage.tsx` lines 1-47 and `client/src/components/layout/PracticeShell.tsx` lines 31-49.【client/src/components/practice/CanonicalPracticePage.tsx:L1-L47】【client/src/components/layout/PracticeShell.tsx:L31-L49】

## Pages with top-left back controls (explicit)
- Guardian calendar: back button to `/guardian`. Evidence: `client/src/pages/guardian-calendar.tsx` lines 204-210.【client/src/pages/guardian-calendar.tsx:L204-L210】
- Legal doc: back button to `/legal`. Evidence: `client/src/pages/legal-doc.tsx` lines 165-174.【client/src/pages/legal-doc.tsx:L165-L174】
- Blog post: back link to `/blog`. Evidence: `client/src/pages/blog-post.tsx` lines 90-95.【client/src/pages/blog-post.tsx:L90-L95】
- Structured practice: back button to `/practice` (pre-session and active header). Evidence: `client/src/pages/structured-practice.tsx` lines 154-160 and 220-225.【client/src/pages/structured-practice.tsx:L154-L160】【client/src/pages/structured-practice.tsx:L220-L225】
- FlowCards: back button to `/practice`. Evidence: `client/src/pages/flow-cards.tsx` lines 276-281.【client/src/pages/flow-cards.tsx:L276-L281】
- Review errors: back controls to `/practice` and exit review. Evidence: `client/src/pages/review-errors.tsx` lines 289-291 and 470-474.【client/src/pages/review-errors.tsx:L289-L291】【client/src/pages/review-errors.tsx:L470-L474】
- PracticeShell header: back button is part of the shared layout. Evidence: `client/src/components/layout/PracticeShell.tsx` lines 31-49.【client/src/components/layout/PracticeShell.tsx:L31-L49】

## Proposed UI consistency rules (for next PRs)
1) **Practice-session screens should use `PracticeShell`** for consistent back, score, and progress UI.
   - Evidence for standard header/back: `PracticeShell` header includes a back button and metrics. 【client/src/components/layout/PracticeShell.tsx:L31-L89】
2) **Detail pages should include an explicit back affordance** when they are not part of the main `AppShell` nav items.
   - Evidence for current nav items list: `AppHeader` nav items include `/dashboard`, `/calendar`, `/flow-cards`, `/practice`, `/full-test`, `/chat`. 【client/src/components/layout/app-shell.tsx:L71-L89】

## Pages that violate the proposed rules (with evidence)
- Rule 1 (PracticeShell usage):
  - `/flow-cards` uses a custom header and back button, not `PracticeShell`. Evidence: `client/src/pages/flow-cards.tsx` lines 270-293.【client/src/pages/flow-cards.tsx:L270-L293】
  - `/structured-practice` uses a custom header and back button, not `PracticeShell`. Evidence: `client/src/pages/structured-practice.tsx` lines 220-246.【client/src/pages/structured-practice.tsx:L220-L246】
- Rule 2 (Back affordance for non-nav pages):
  - `/mastery` has no back control in its header. Evidence: `client/src/pages/mastery.tsx` lines 7-17.【client/src/pages/mastery.tsx:L7-L17】
  - `/profile` has no back control in its header. Evidence: `client/src/pages/UserProfile.tsx` lines 169-179.【client/src/pages/UserProfile.tsx:L169-L179】
