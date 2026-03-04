# LAUNCH GATE E2E MATRIX

| Feature | UI Route | API Endpoint | DB Table | Proofs Ref |
|---------|----------|--------------|----------|------------|
| Gate 1: Auth | `/login` | `/api/auth/signin` | `users` | Gate 1 |
| Gate 2: Content | `/digital-sat/practice` | `/api/practice/next` | `questions` | Gate 2 |
| Gate 3: Practice | `/dashboard` | `/api/practice/answer` | `practice_sessions` | Gate 3 |
| Gate 4: Mastery | N/A | `/api/mastery/skills` | `progress` | Gate 4 |
| Gate 5: Tutor | N/A | `/api/tutor-v2` | `tutor_interactions` | Gate 5 |
| Gate 6: Exam | `/exam` | `/api/full-length/sessions` | `exam_sessions` | Gate 6 |
| Gate 7: Calendar| N/A | N/A | N/A | Gate 7 |
| Gate 8: KPIs | N/A | `/api/admin/stats` | N/A | Gate 8 |
| Gate 9: Billing | `/pricing` | `/api/billing/checkout` | `subscriptions` | Gate 9 |
| Gate 10: Admin | `/admin` | `/api/admin/questions/:id/approve` | `questions` | Gate 10 |
| Gate 11: Logging| N/A | N/A | N/A | Gate 11 |
| Gate 12: Trust | `/trust` | `/trust` | N/A | Gate 12 |
