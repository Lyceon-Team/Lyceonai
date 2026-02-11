# P01 Sprint 3 Mastery Re-Audit Proofs

## A) Provenance + green build/tests (required)

### Command
```bash
git rev-parse --show-toplevel
```

Output:
```text
/workspace/Lyceonai
```

### Command
```bash
git rev-parse --abbrev-ref HEAD
```

Output:
```text
work
```

### Command
```bash
git rev-parse HEAD
```

Output:
```text
2d9b1c6b687a3a7423f3da9049f96e7d8abc6275
```

### Command
```bash
git log -1 --oneline
```

Output:
```text
2d9b1c6 Merge pull request #70 from Lyceon-Team/copilot/implement-true-half-life-mastery
```

### Command
```bash
git status --porcelain
```

Output:
```text
```

### Command
```bash
node -v
```

Output:
```text
v22.21.1
```

### Command
```bash
pnpm -v
```

Output:
```text
10.13.1
```

### Command
```bash
pnpm -s run build
```

Output:
```text
vite v7.3.1 building client environment for production...
transforming...
✓ 2184 modules transformed.
rendering chunks...
computing gzip size...
../dist/public/assets/KaTeX_Size3-Regular-CTq5MqoE.woff           4.42 kB
../dist/public/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2          4.93 kB
../dist/public/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2          5.21 kB
../dist/public/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2          5.47 kB
../dist/public/assets/KaTeX_Size4-Regular-BF-4gkZK.woff           5.98 kB
../dist/public/assets/KaTeX_Size2-Regular-oD1tc_U0.woff           6.19 kB
../dist/public/index.html                                         6.31 kB │ gzip:   2.04 kB
../dist/public/assets/KaTeX_Size1-Regular-C195tn64.woff           6.50 kB
../dist/public/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2    6.91 kB
../dist/public/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2       6.91 kB
../dist/public/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf            7.59 kB
../dist/public/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff     7.66 kB
../dist/public/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff        7.72 kB
../dist/public/assets/KaTeX_Script-Regular-D3wIWfF6.woff2         9.64 kB
../dist/public/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2     10.34 kB
../dist/public/assets/KaTeX_Size4-Regular-DWFBv043.ttf           10.36 kB
../dist/public/assets/KaTeX_Script-Regular-D5yQViql.woff         10.59 kB
../dist/public/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2       11.32 kB
../dist/public/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2          11.35 kB
../dist/public/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf           11.51 kB
../dist/public/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2      12.03 kB
../dist/public/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2        12.22 kB
../dist/public/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf           12.23 kB
../dist/public/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff      12.32 kB
../dist/public/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf     12.34 kB
../dist/public/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf        12.37 kB
../dist/public/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff        13.21 kB
../dist/public/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff           13.30 kB
../dist/public/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2    13.57 kB
../dist/public/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff       14.11 kB
../dist/public/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff         14.41 kB
../dist/public/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff     16.03 kB
../dist/public/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2       16.40 kB
../dist/public/assets/KaTeX_Math-Italic-t53AETM-.woff2           16.44 kB
../dist/public/assets/KaTeX_Script-Regular-C5JkGWo-.ttf          16.65 kB
../dist/public/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2       16.78 kB
../dist/public/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2           16.99 kB
../dist/public/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff        18.67 kB
../dist/public/assets/KaTeX_Math-Italic-DA0__PXp.woff            18.75 kB
../dist/public/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff        19.41 kB
../dist/public/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf       19.44 kB
../dist/public/assets/KaTeX_Fraktur-Regular-CB_wures.ttf         19.57 kB
../dist/public/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf            19.58 kB
../dist/public/assets/KaTeX_Main-Italic-BMLOBm91.woff            19.68 kB
../dist/public/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf        22.36 kB
../dist/public/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf          24.50 kB
../dist/public/assets/KaTeX_Main-Bold-Cx986IdX.woff2             25.32 kB
../dist/public/assets/KaTeX_Main-Regular-B22Nviop.woff2          26.27 kB
../dist/public/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf      27.56 kB
../dist/public/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2           28.08 kB
../dist/public/assets/KaTeX_Main-Bold-Jm3AIy58.woff              29.91 kB
../dist/public/assets/KaTeX_Main-Regular-Dr94JaBh.woff           30.77 kB
../dist/public/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf         31.20 kB
../dist/public/assets/KaTeX_Math-Italic-flOr_0UB.ttf             31.31 kB
../dist/public/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf         32.97 kB
../dist/public/assets/KaTeX_AMS-Regular-DMm9YOAa.woff            33.52 kB
../dist/public/assets/KaTeX_Main-Italic-3WenGoN9.ttf             33.58 kB
../dist/public/assets/KaTeX_Main-Bold-waoOVXN0.ttf               51.34 kB
../dist/public/assets/KaTeX_Main-Regular-ypZvNtVU.ttf            53.58 kB
../dist/public/assets/KaTeX_AMS-Regular-DRggAlZN.ttf             63.63 kB
../dist/public/assets/index-Hj0CsUKK.css                        160.82 kB │ gzip:  29.54 kB
../dist/public/assets/index-BdQq_4o_.js                           0.06 kB │ gzip:   0.08 kB
../dist/public/assets/chevron-left-BrfRzwTo.js                    0.13 kB │ gzip:   0.14 kB
../dist/public/assets/chevron-right-COmlX-QP.js                   0.13 kB │ gzip:   0.14 kB
../dist/public/assets/play-B_MQ8Rda.js                            0.13 kB │ gzip:   0.14 kB
../dist/public/assets/loader-circle-Cp-uEMgD.js                   0.14 kB │ gzip:   0.15 kB
../dist/public/assets/plus-DXD6Bm91.js                            0.15 kB │ gzip:   0.15 kB
../dist/public/assets/arrow-right-BfyCVcDY.js                     0.16 kB │ gzip:   0.16 kB
../dist/public/assets/arrow-left-DFUe4YF1.js                      0.16 kB │ gzip:   0.16 kB
../dist/public/assets/search-DoB1mSfK.js                          0.16 kB │ gzip:   0.16 kB
../dist/public/assets/circle-check-big-DBy7yFlB.js                0.18 kB │ gzip:   0.18 kB
../dist/public/assets/info-C9M_55ww.js                            0.20 kB │ gzip:   0.17 kB
../dist/public/assets/circle-x-DYcL7eaD.js                        0.20 kB │ gzip:   0.17 kB
../dist/public/assets/external-link-wE67bLOD.js                   0.25 kB │ gzip:   0.20 kB
../dist/public/assets/calendar-CTmG3alV.js                        0.25 kB │ gzip:   0.20 kB
../dist/public/assets/triangle-alert-Dp_-ry3h.js                  0.26 kB │ gzip:   0.21 kB
../dist/public/assets/award-BQnJCYyU.js                           0.27 kB │ gzip:   0.22 kB
../dist/public/assets/book-open-Caqo4AJ0.js                       0.28 kB │ gzip:   0.20 kB
../dist/public/assets/flame-B23fz1MW.js                           0.28 kB │ gzip:   0.22 kB
../dist/public/assets/users-5-YzxzzS.js                           0.30 kB │ gzip:   0.22 kB
../dist/public/assets/refresh-cw-B1OHtoBy.js                      0.32 kB │ gzip:   0.23 kB
../dist/public/assets/file-text-D2zdtVq8.js                       0.33 kB │ gzip:   0.21 kB
../dist/public/assets/math-practice-B5_a-prE.js                   0.40 kB │ gzip:   0.28 kB
../dist/public/assets/random-practice-C0KbqUQk.js                 0.41 kB │ gzip:   0.28 kB
../dist/public/assets/reading-writing-practice-ZXopzcIS.js        0.44 kB │ gzip:   0.29 kB
../dist/public/assets/zap-osuWZqpI.js                             0.45 kB │ gzip:   0.30 kB
../dist/public/assets/calculator-BiujeQso.js                      0.53 kB │ gzip:   0.28 kB
../dist/public/assets/empty-state-BO84rKho.js                     0.58 kB │ gzip:   0.34 kB
../dist/public/assets/tag-BFLlAJpj.js                             0.60 kB │ gzip:   0.34 kB
../dist/public/assets/page-card-Bs4q8DBc.js                       0.61 kB │ gzip:   0.34 kB
../dist/public/assets/badge-B4yUjmyO.js                           0.78 kB │ gzip:   0.41 kB
../dist/public/assets/calendarApi-D2aifG9Q.js                     0.78 kB │ gzip:   0.39 kB
../dist/public/assets/index-BVsyHwOX.js                           1.04 kB │ gzip:   0.55 kB
../dist/public/assets/progress-Ccjs9BkM.js                        1.93 kB │ gzip:   0.96 kB
../dist/public/assets/question-renderer-C7Zm3sFz.js               2.79 kB │ gzip:   1.13 kB
../dist/public/assets/blog-CxqwlmZE.js                            2.82 kB │ gzip:   1.11 kB
../dist/public/assets/mastery-D5fxyL_J.js                         3.92 kB │ gzip:   1.44 kB
../dist/public/assets/PracticeErrorBoundary-Yfd_weYs.js           4.46 kB │ gzip:   2.01 kB
../dist/public/assets/full-test-Dsa0P1ac.js                       4.64 kB │ gzip:   1.50 kB
../dist/public/assets/index-DQg4wWT3.js                           5.29 kB │ gzip:   2.07 kB
../dist/public/assets/blog-post-DvZQUwys.js                       5.74 kB │ gzip:   1.91 kB
../dist/public/assets/AdminPortal-CDHckn6H.js                     6.54 kB │ gzip:   2.06 kB
../dist/public/assets/browse-topics-BIzP6ydr.js                   6.62 kB │ gzip:   2.14 kB
../dist/public/assets/legal-ipFnsJk_.js                           6.68 kB │ gzip:   2.01 kB
../dist/public/assets/chat-bj7cSKLU.js                            7.29 kB │ gzip:   2.78 kB
../dist/public/assets/digital-sat-CStUqjs7.js                     7.29 kB │ gzip:   2.37 kB
../dist/public/assets/legal-doc-DhEThSWB.js                       7.33 kB │ gzip:   2.71 kB
../dist/public/assets/CanonicalPracticePage-M7_b4jDh.js           7.44 kB │ gzip:   2.56 kB
../dist/public/assets/flow-cards-WwaUNr5M.js                      7.94 kB │ gzip:   2.65 kB
../dist/public/assets/guardian-calendar-CUIKOTer.js               7.97 kB │ gzip:   2.63 kB
../dist/public/assets/digital-sat-math-CJCHIMkd.js                8.81 kB │ gzip:   2.74 kB
../dist/public/assets/useQuery-TVzUeB-s.js                        8.82 kB │ gzip:   3.20 kB
../dist/public/assets/digital-sat-reading-writing-nfywcvZy.js     9.61 kB │ gzip:   3.05 kB
../dist/public/assets/structured-practice-Cb71ff69.js            10.19 kB │ gzip:   3.32 kB
../dist/public/assets/blog-C-hfdzlT.js                           10.78 kB │ gzip:   4.59 kB
../dist/public/assets/practice-Jc5DNsbn.js                       12.17 kB │ gzip:   2.80 kB
../dist/public/assets/scroll-area-CDr0emnR.js                    12.62 kB │ gzip:   4.01 kB
../dist/public/assets/calendar-Dnhy9u_e.js                       12.94 kB │ gzip:   4.46 kB
../dist/public/assets/UserProfile-BQqZ5-pM.js                    13.58 kB │ gzip:   4.28 kB
../dist/public/assets/review-errors-CZ7L8Z5I.js                  16.61 kB │ gzip:   4.12 kB
../dist/public/assets/lyceon-dashboard-BRTrTmEq.js               17.51 kB │ gzip:   4.64 kB
../dist/public/assets/index-DPEECz1Q.js                          18.74 kB │ gzip:   7.02 kB
../dist/public/assets/select-BO_QH11y.js                         20.92 kB │ gzip:   7.30 kB
../dist/public/assets/guardian-dashboard-B_RQ6ilB.js             26.20 kB │ gzip:   7.22 kB
../dist/public/assets/legal-BJ2zxem5.js                          34.24 kB │ gzip:  10.46 kB
../dist/public/assets/app-shell-SlMRxZca.js                      37.46 kB │ gzip:  11.05 kB
../dist/public/assets/luxon-BDx6lZXm.js                          71.37 kB │ gzip:  22.22 kB
../dist/public/assets/profile-complete-B7n7V3d_.js              104.05 kB │ gzip:  28.17 kB
../dist/public/assets/MathRenderer-C6RDkJvv.js                  268.96 kB │ gzip:  78.61 kB
../dist/public/assets/index-Iy17ZA4y.js                         462.03 kB │ gzip: 148.11 kB
✓ built in 12.30s
Building server with esbuild...
Entry: /workspace/Lyceonai/server/index.ts
Output: /workspace/Lyceonai/dist/index.js
✓ Server bundle created at /workspace/Lyceonai/dist/index.js
✓ All local files bundled, all npm packages external

  dist/index.js      384.3kb
  dist/index.js.map  769.0kb

⚡ Done in 153ms
```

### Command
```bash
pnpm -s test
```

Output:
```text

 RUN  v4.0.17 /workspace/Lyceonai

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
🔧 [OCR] Provider resolved: auto -> auto

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]
[CORS] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Health check (GET /api/health) should be accessible without auth
ℹ️  04:48:11 INFO  [HTTP]       request: GET /api/health 200
   Data: {
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration_ms: 7,
  request_id: 'c2a9d270-629c-4b99-82af-f644471e4233',
  user_id: null
}
GET /api/health 200 8ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Recent questions (GET /api/questions/recent?limit=5) should be accessible without auth
[SUPABASE-HTTP] Test mode: using placeholder client

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Recent questions (GET /api/questions/recent?limit=5) should be accessible without auth
ℹ️  04:48:11 INFO  [HTTP]       request: GET /api/questions/recent 200
   Data: {
  method: 'GET',
  path: '/api/questions/recent',
  status: 200,
  duration_ms: 77,
  request_id: '2a69bbf6-1ba2-40f8-8084-f8e0341b687a',
  user_id: null
}
GET /api/questions/recent 200 78ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Search questions (GET /api/questions/search?q=test) should be accessible without auth
[SUPABASE] Test mode: using placeholder client
🔍 Generating embedding for query: "test"

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Search questions (GET /api/questions/search?q=test) should be accessible without auth
ℹ️  04:48:11 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 9,
  request_id: '4ac032bf-e452-4e2b-a54c-98a9af489422',
  user_id: null
}
GET /api/questions/search 200 9ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Get auth user (GET /api/auth/user) should be accessible without auth
ℹ️  04:48:11 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 2,
  request_id: '66bd15a3-a107-4c6f-84e0-5ae566db586e',
  user_id: null
}
GET /user 200 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > should return user as null for unauthenticated /api/auth/user requests
ℹ️  04:48:11 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 1,
  request_id: 'c65a76eb-3794-4647-8592-2ee2cd54bd0a',
  user_id: null
}
GET /user 200 1ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > User profile (GET /api/profile) should require authentication
GET /api/profile 401 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > RAG endpoint (POST /api/rag) should require authentication
POST /api/rag 401 16ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > RAG v2 endpoint (POST /api/rag/v2) should require authentication
POST / 401 3ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > Tutor v2 (POST /api/tutor/v2) should require authentication
POST / 401 5ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > Practice sessions (POST /api/practice/sessions) should require authentication
POST /sessions 401 3ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Routes - Admin Auth Required > Questions needing review (GET /api/admin/questions/needs-review) should require authentication
GET /questions/needs-review 401 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Routes - Admin Auth Required > Admin health endpoint (GET /api/admin/health) should require authentication
GET /health 401 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > User Identity Derivation > should derive user ID from auth token, not request body
POST /sessions 401 3ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > User Identity Derivation > should not accept user_id in query parameters for auth bypass
GET /api/profile 401 1ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > FERPA Compliance - Under-13 Consent > should require authentication for practice endpoints (FERPA check)
POST /sessions 401 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Role-Based Access Control > should reject unauthenticated access to student-only routes
POST /sessions 401 1ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Role-Based Access Control > should reject unauthenticated access to guardian routes
GET /students 401 1ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > HTTP Method Validation > should reject POST to GET-only endpoints
POST /api/questions/recent 404 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > HTTP Method Validation > should handle GET to POST-only endpoints appropriately
GET /sessions 401 1ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Request Validation > should validate required fields in POST requests
POST /exchange-session 400 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Response Format > should return JSON for API endpoints
ℹ️  04:48:11 INFO  [HTTP]       request: GET /api/health 200
   Data: {
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration_ms: 0,
  request_id: '59ac83eb-cc23-46ea-ae6a-72d78d3c6d79',
  user_id: null
}
GET /api/health 200 0ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Response Format > should include error field in error responses
GET /api/profile 401 0ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Health Endpoint Security > should not leak SUPABASE_SERVICE_ROLE_KEY in response
GET /health 401 1ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Health Endpoint Security > should require admin role for health endpoint
GET /health 401 0ms

 ✓ tests/ci/routes.ci.test.ts (24 tests) 1976ms
stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
🔧 [OCR] Provider resolved: auto -> auto

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]
[CORS] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should reject Authorization: Bearer header without cookie
GET /api/profile 401 11ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should reject Authorization: Bearer header even with valid-looking token
GET /api/profile 401 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should return 401 for protected routes without any auth
GET /api/profile 401 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should return 401 for missing sb-access-token cookie
GET /api/profile 401 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/health without auth
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/health 200
   Data: {
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration_ms: 2,
  request_id: '9b5968d2-606e-4063-bf99-46a20d93b8ba',
  user_id: null
}
GET /api/health 200 3ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/recent without auth
[SUPABASE-HTTP] Test mode: using placeholder client

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/recent without auth
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/recent 200
   Data: {
  method: 'GET',
  path: '/api/questions/recent',
  status: 200,
  duration_ms: 91,
  request_id: '72c3132c-e173-4ead-b1f2-205a3c7cd040',
  user_id: null
}
GET /api/questions/recent 200 91ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/search without auth
[SUPABASE] Test mode: using placeholder client
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/search without auth
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 5,
  request_id: '83124db1-c53b-4b92-90d9-6c134d1eec53',
  user_id: null
}
GET /api/questions/search 200 5ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should return user as null for /api/auth/user without auth
ℹ️  04:48:12 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 2,
  request_id: '4edff789-db91-4cab-a42f-bd1b9b75c26c',
  user_id: null
}
GET /user 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for profile (GET /api/profile)
GET /api/profile 401 3ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for practice sessions (POST /api/practice/sessions)
POST /sessions 401 11ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for RAG endpoint (POST /api/rag)
POST /api/rag 401 5ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for Tutor v2 (POST /api/tutor/v2)
POST / 401 1ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should block POST /api/rag without Origin/Referer (CSRF protection)
POST /api/rag 403 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Admin Endpoints - Admin Auth Required > should return 401 for admin routes without auth
GET /questions/needs-review 401 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Token Security > should not expose tokens in /api/auth/user response
ℹ️  04:48:12 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 1,
  request_id: 'f172939d-e5f2-411e-b929-474d08eba0b6',
  user_id: null
}
GET /user 200 1ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Token Security > should reject short/invalid tokens
GET /api/profile 401 1ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie Security > should not set auth cookies on public endpoints
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/recent 200
   Data: {
  method: 'GET',
  path: '/api/questions/recent',
  status: 200,
  duration_ms: 29,
  request_id: '0cafc14d-ba2d-45bb-b4b2-80ead077c01d',
  user_id: null
}
GET /api/questions/recent 200 30ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Session Exchange Endpoint > should require tokens in exchange-session endpoint
POST /exchange-session 400 1ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Session Exchange Endpoint > should validate token format in exchange-session
POST /exchange-session 500 5ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Error Handling > should return 404 for non-existent API routes
GET /api/nonexistent 404 3ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Error Handling > should handle malformed JSON gracefully
POST /api/auth/exchange-session 400 4ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 3,
  request_id: '2fe47f19-ad9d-4a90-aa66-8b3e29ffd580',
  user_id: null
}
GET /api/questions/search 200 3ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: 'b65f5382-46fc-4bc5-99b6-03c4b9a7b1ff',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '5a5778e7-695f-4a6a-a473-a619ed9bc79c',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: 'f3ecd4aa-cde0-404d-949b-4a02f505930f',
  user_id: null
}
GET /api/questions/search 200 3ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '8ab4f01b-5542-4244-8030-33f1a6ad7bd2',
  user_id: null
}
GET /api/questions/search 200 3ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '2a06efd8-5cff-428c-b643-45636c121668',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '3de1b616-a10d-4018-9977-c59ebc336d32',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 3,
  request_id: 'b9883edc-0a9b-4997-8b1d-782c6492815e',
  user_id: null
}
GET /api/questions/search 200 3ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '3048611e-d376-4558-989e-9aab09a7e68e',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:48:12 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '974e6872-5d2f-47da-bc47-c73aaf8f2b3a',
  user_id: null
}
GET /api/questions/search 200 2ms

 ✓ tests/ci/auth.ci.test.ts (22 tests) 979ms
stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
🔧 [OCR] Provider resolved: auto -> auto

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]
[CORS] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Missing Origin/Referer > should block POST requests without Origin/Referer (403)
POST /signout 403 9ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Missing Origin/Referer > should block POST to exchange-session without Origin/Referer
POST /exchange-session 500 18ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Valid Origins > should allow POST with valid Origin: http://localhost:5000
ℹ️  04:48:13 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:48:13 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 3,
  request_id: '3e3ae7cd-ddaa-4a12-b582-735a6e3c5b0d',
  user_id: null
}
POST /signout 200 3ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Valid Origins > should allow POST with valid Origin: http://localhost:3000
ℹ️  04:48:13 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:48:13 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 2,
  request_id: '6c229760-2cbe-4e2f-8a9e-ef9b6a6d20fa',
  user_id: null
}
POST /signout 200 2ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Valid Origins > should allow POST with valid Referer header
ℹ️  04:48:13 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:48:13 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 2,
  request_id: 'c8fed461-0b82-4841-b205-4f829c1d19ae',
  user_id: null
}
POST /signout 200 2ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: https://evil.com
POST /signout 403 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: http://localhost:5000.evil.com
POST /signout 403 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: http://evil.com
POST /signout 403 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: https://attacker.com
POST /signout 403 3ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block hostname-prefix impersonation (localhost:5000.evil.com)
POST /signout 403 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block subdomain impersonation via Referer
POST /signout 403 2ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block trailing domain impersonation
POST /signout 403 2ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Empty Origin Bypass Prevention > should not bypass CSRF with empty origin entries
POST /signout 403 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Empty Origin Bypass Prevention > should block requests with only whitespace in Origin
POST /signout 403 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET requests without Origin/Referer
ℹ️  04:48:13 INFO  [HTTP]       request: GET /api/health 200
   Data: {
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration_ms: 0,
  request_id: '407f2471-6ea2-4a17-8ef4-9064dc255357',
  user_id: null
}
GET /api/health 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET to /api/auth/user without Origin/Referer
ℹ️  04:48:13 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 1,
  request_id: 'a75f3fc3-2ed7-4b4a-8d9e-a8b66a7956b8',
  user_id: null
}
GET /user 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET to public questions endpoint without Origin/Referer
[SUPABASE-HTTP] Test mode: using placeholder client

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET to public questions endpoint without Origin/Referer
ℹ️  04:48:14 INFO  [HTTP]       request: GET /api/questions/recent 200
   Data: {
  method: 'GET',
  path: '/api/questions/recent',
  status: 200,
  duration_ms: 70,
  request_id: 'ab06891c-a4f0-48ba-b31f-5821ff52963b',
  user_id: null
}
GET /api/questions/recent 200 70ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - HEAD and OPTIONS Requests > should allow HEAD requests without Origin/Referer
ℹ️  04:48:14 INFO  [HTTP]       request: HEAD /api/health 200
   Data: {
  method: 'HEAD',
  path: '/api/health',
  status: 200,
  duration_ms: 0,
  request_id: '9aaa1c71-2ceb-4edf-b7a6-ccd480272e85',
  user_id: null
}
HEAD /api/health 200 0ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - HEAD and OPTIONS Requests > should allow OPTIONS requests without Origin/Referer
ℹ️  04:48:14 INFO  [HTTP]       request: OPTIONS /api/health 204
   Data: {
  method: 'OPTIONS',
  path: '/api/health',
  status: 204,
  duration_ms: 0,
  request_id: 'a03d20e2-14e4-4469-848b-74bff4ed8823',
  user_id: null
}
OPTIONS /api/health 204 0ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Case Sensitivity > should handle Origin header case-insensitively
ℹ️  04:48:14 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:48:14 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 1,
  request_id: '395ecd98-d23d-442d-82b3-2b8aeac960fc',
  user_id: null
}
POST /signout 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Protocol Variants > should block http origin when https is required
POST /signout 403 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Multiple Headers > should validate Origin when both Origin and Referer are present
ℹ️  04:48:14 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:48:14 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 1,
  request_id: '5ef76a74-3ece-4488-9e93-5d829f76b0d1',
  user_id: null
}
POST /signout 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Multiple Headers > should allow request if either Origin OR Referer is valid
ℹ️  04:48:14 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:48:14 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 1,
  request_id: '0c15fd14-d1bf-4356-9482-44114c668f28',
  user_id: null
}
POST /signout 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Multiple Headers > should block when both Origin and Referer are invalid
POST /signout 403 1ms

 ✓ tests/ci/security.ci.test.ts (24 tests) 770ms
 ✓ apps/api/test/mastery-writepaths.guard.test.ts (3 tests) 151ms
stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
🔧 [OCR] Provider resolved: auto -> auto

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]
[CORS] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/idor.regression.test.ts > IDOR Regression Invariants > tutor_v2_userid_from_auth_not_body
POST / 401 33ms

stdout | tests/idor.regression.test.ts > IDOR Regression Invariants > tutor_v2_userid_from_auth_not_body
POST / 401 3ms

stdout | tests/idor.regression.test.ts > IDOR Regression Invariants > progress_review_attempt_rejects_foreign_session
[SUPABASE-HTTP] Client initialized

 ✓ tests/idor.regression.test.ts (2 tests) 116ms
 ✓ tests/mastery.writepaths.guard.test.ts (3 tests) 81ms
stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
🔧 [OCR] Provider resolved: auto -> auto

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]
[CORS] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_cookie_only_api_rag_rejects_bearer
POST /api/rag 403 20ms

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_rag_v2_requires_cookie
POST / 403 4ms

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
POST / 403 13ms

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
POST / 403 3ms

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > admin_db_health_requires_admin
GET /db-health 401 3ms

 ✓ tests/entitlements.regression.test.ts (4 tests) 104ms
stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
🔧 [OCR] Provider resolved: auto -> auto

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]
[CORS] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/tutor.v2.regression.test.ts > Tutor V2 Security Regression > PRAC-002: rejects unauthenticated requests (no cookie)
POST / 401 34ms

stdout | tests/tutor.v2.regression.test.ts > Tutor V2 Security Regression > PRAC-002: rejects bearer auth (cookie-only endpoint)
POST / 401 2ms

 ✓ tests/tutor.v2.regression.test.ts (2 tests) 85ms
 ✓ client/src/__tests__/toaster.guard.test.tsx (1 test) 66ms
stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
🔧 [OCR] Provider resolved: auto -> auto

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]
[CORS] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://localhost:3001'
]

stdout | tests/practice.validate.regression.test.ts > Practice/Questions Validate Security Regression > PRAC-001: rejects unauthenticated requests (no cookie)
POST /api/questions/validate 401 19ms

stdout | tests/practice.validate.regression.test.ts > Practice/Questions Validate Security Regression > PRAC-001: rejects bearer auth (cookie-only endpoint)
POST /api/questions/validate 401 3ms

 ✓ tests/practice.validate.regression.test.ts (2 tests) 59ms
stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should return a question for math section
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'hard',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should return a question for math section
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should use cluster mode when specified
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'hard',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should use cluster mode when specified
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should use skill mode when specified
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'hard',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should use skill mode when specified
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should respect fixed difficulty policy
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'hard',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should respect fixed difficulty policy
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should include rationale with filter path
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'hard',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should include rationale with filter path
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should handle rw section correctly
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'rw',
  difficultyBucket: 'medium',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: rw

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should handle rw section correctly
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should map question to student format correctly
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'hard',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should map question to student format correctly
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > balanced mode picks from cluster shortlist deterministically
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'medium',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > balanced mode picks from cluster shortlist deterministically
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > balanced mode picks from cluster shortlist deterministically
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'medium',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > balanced mode picks from cluster shortlist deterministically
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > difficulty randomness is deterministic per seed
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'medium',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > difficulty randomness is deterministic per seed
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > difficulty randomness is deterministic per seed
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'medium',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > difficulty randomness is deterministic per seed
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > difficulty randomness is deterministic per seed
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'medium',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > difficulty randomness is deterministic per seed
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > difficulty randomness is deterministic per seed
[AdaptiveSelector] queryCandidateQuestions called with: {
  section: 'math',
  difficultyBucket: 'medium',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math

stdout | apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > difficulty randomness is deterministic per seed
[AdaptiveSelector] Query result: { hasError: false, errorMessage: undefined, dataCount: 3 }

 ✓ apps/api/src/services/__tests__/adaptiveSelector.test.ts (9 tests) 78ms
stdout | apps/api/test/rag-service.test.ts > RagService > Weakness Area Extraction > should identify M.LIN.1 as weak area when incorrect > correct
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Weakness Area Extraction > should identify M.GEO.2 as strong area when correct > incorrect
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Weakness Area Extraction > should return empty arrays for profile with no competency map
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Weakness Area Extraction > should ignore competencies with fewer than 3 attempts
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test A: Weakness Boosting > should rank weak competency match higher due to weakness boost
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test A: Weakness Boosting > should rank weak competency match higher due to weakness boost
📊 [RAG-V2] Top match score breakdown: {
  combinedScore: '0.520',
  semanticSim: 0.8,
  competencyMatch: 0,
  difficultyMatch: 0,
  weaknessBoost: 1,
  recencyScore: 0,
  qualityBonus: 0.1
}

stdout | apps/api/test/rag-service.test.ts > RagService > Test A: Weakness Boosting > should compute weakness boost as 1 when match competency is in weak areas
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test A: Weakness Boosting > should compute weakness boost as 0 when no overlap
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test B: Difficulty Match Scoring > should score 1.0 for exact difficulty match
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test B: Difficulty Match Scoring > should score 0.5 for adjacent difficulties (easy-medium)
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test B: Difficulty Match Scoring > should score 0 for non-adjacent difficulties (easy-hard)
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test B: Difficulty Match Scoring > should score 0 when either difficulty is null
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test B: Difficulty Match Scoring > should rank medium difficulty higher than hard when target is medium
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test B: Difficulty Match Scoring > should rank medium difficulty higher than hard when target is medium
📊 [RAG-V2] Top match score breakdown: {
  combinedScore: '0.490',
  semanticSim: 0.85,
  competencyMatch: 0,
  difficultyMatch: 1,
  weaknessBoost: 0,
  recencyScore: 0,
  qualityBonus: 0.05
}

stdout | apps/api/test/rag-service.test.ts > RagService > Test C: Strategy Mode - No Vector/DB Calls > should not call vector client in strategy mode
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test C: Strategy Mode - No Vector/DB Calls > should not call question repository in strategy mode
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test C: Strategy Mode - No Vector/DB Calls > should return empty questions in strategy mode
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Test C: Strategy Mode - No Vector/DB Calls > should include student profile in strategy mode response
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Concept Mode with Mocks > should call vector client in concept mode
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Concept Mode with Mocks > should call vector client in concept mode
📊 [RAG-V2] Top match score breakdown: {
  combinedScore: '0.540',
  semanticSim: 0.85,
  competencyMatch: 0,
  difficultyMatch: 0,
  weaknessBoost: 1,
  recencyScore: 0,
  qualityBonus: 0.1
}

stdout | apps/api/test/rag-service.test.ts > RagService > Concept Mode with Mocks > should load questions for matches in concept mode
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Concept Mode with Mocks > should load questions for matches in concept mode
📊 [RAG-V2] Top match score breakdown: {
  combinedScore: '0.540',
  semanticSim: 0.85,
  competencyMatch: 0,
  difficultyMatch: 0,
  weaknessBoost: 1,
  recencyScore: 0,
  qualityBonus: 0.1
}

stdout | apps/api/test/rag-service.test.ts > RagService > Concept Mode with Mocks > should identify weak and strong areas in competency context
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > PRP Scoring Weights > should have correct scoring weight values
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > PRP Scoring Weights > should sum to 1.0
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Combined Scoring > should correctly combine all scoring factors
🔍 [RAG-V2] RagService initialized

stdout | apps/api/test/rag-service.test.ts > RagService > Combined Scoring > should correctly combine all scoring factors
📊 [RAG-V2] Top match score breakdown: {
  combinedScore: '0.960',
  semanticSim: 0.9,
  competencyMatch: 1,
  difficultyMatch: 1,
  weaknessBoost: 1,
  recencyScore: 0,
  qualityBonus: 0.1
}

 ✓ apps/api/test/rag-service.test.ts (22 tests) 43ms
 ✓ client/src/__tests__/useShortcuts.guard.test.tsx (1 test) 35ms
 ✓ tests/mastery.true-halflife.edgecases.test.ts (13 tests) 18ms
 ✓ apps/api/src/lib/__tests__/canonicalId.test.ts (19 tests) 16ms

 Test Files  15 passed (15)
      Tests  151 passed (151)
   Start at  04:48:08
   Duration  16.66s (transform 1.61s, setup 0ms, import 5.25s, tests 4.58s, environment 2.21s)

 DEPRECATED  `test.poolOptions` was removed in Vitest 4. All previous `poolOptions` are now top-level options. Please, refer to the migration guide: https://vitest.dev/guide/migration#pool-rework
stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Recent questions (GET /api/questions/recent?limit=5) should be accessible without auth
Error fetching recent questions (Supabase HTTP): {
  message: 'TypeError: fetch failed',
  details: 'TypeError: fetch failed\n' +
    '\n' +
    'Caused by: Error: getaddrinfo ENOTFOUND placeholder.supabase.co (ENOTFOUND)\n' +
    'Error: getaddrinfo ENOTFOUND placeholder.supabase.co\n' +
    '    at GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:122:26)',
  hint: '',
  code: ''
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Search questions (GET /api/questions/search?q=test) should be accessible without auth
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > User profile (GET /api/profile) should require authentication
⚠️  04:48:11 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 1,
  request_id: '5dcc041a-a3e8-4d05-b70d-3b5c1bcc9948',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > RAG endpoint (POST /api/rag) should require authentication
⚠️  04:48:11 WARN  [HTTP]       request: POST /api/rag 401
   Data: {
  method: 'POST',
  path: '/api/rag',
  status: 401,
  duration_ms: 16,
  request_id: 'fae0be9b-fd25-4ab8-bac2-fe1067317b01',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > RAG v2 endpoint (POST /api/rag/v2) should require authentication
⚠️  04:48:11 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 3,
  request_id: 'ecd7b2e1-ece4-43a8-857b-46a7e1c2d484',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > Tutor v2 (POST /api/tutor/v2) should require authentication
⚠️  04:48:11 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 4,
  request_id: 'cb383534-ee79-4e8c-bea6-15ad7edd91b1',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > Practice sessions (POST /api/practice/sessions) should require authentication
⚠️  04:48:11 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 3,
  request_id: 'cb85e8ff-b849-4d55-91c1-98abb1b276e9',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Routes - Admin Auth Required > Questions needing review (GET /api/admin/questions/needs-review) should require authentication
⚠️  04:48:11 WARN  [HTTP]       request: GET /questions/needs-review 401
   Data: {
  method: 'GET',
  path: '/questions/needs-review',
  status: 401,
  duration_ms: 2,
  request_id: '3911da8e-9007-45f9-876b-0b6ad2e0089d',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Routes - Admin Auth Required > Admin health endpoint (GET /api/admin/health) should require authentication
⚠️  04:48:11 WARN  [HTTP]       request: GET /health 401
   Data: {
  method: 'GET',
  path: '/health',
  status: 401,
  duration_ms: 1,
  request_id: 'e9787477-9d67-4bc6-85f4-27432a154464',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > User Identity Derivation > should derive user ID from auth token, not request body
⚠️  04:48:11 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 2,
  request_id: 'af8a655c-37da-40e9-88f0-3b7f7b6a10ab',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > User Identity Derivation > should not accept user_id in query parameters for auth bypass
⚠️  04:48:11 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 0,
  request_id: 'af156cbb-ddd7-4b6b-a665-db1c632548a2',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > FERPA Compliance - Under-13 Consent > should require authentication for practice endpoints (FERPA check)
⚠️  04:48:11 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 2,
  request_id: '239bb8a4-c4d6-4e51-834a-30f952c7a6db',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Role-Based Access Control > should reject unauthenticated access to student-only routes
⚠️  04:48:11 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 1,
  request_id: '65acbaf0-bd43-457b-a9dc-85cc24130541',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Role-Based Access Control > should reject unauthenticated access to guardian routes
⚠️  04:48:11 WARN  [HTTP]       request: GET /students 401
   Data: {
  method: 'GET',
  path: '/students',
  status: 401,
  duration_ms: 1,
  request_id: 'ab8ee26e-3807-4385-aea5-51cfb9c0dc78',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > HTTP Method Validation > should reject POST to GET-only endpoints
⚠️  04:48:11 WARN  [HTTP]       request: POST /api/questions/recent 404
   Data: {
  method: 'POST',
  path: '/api/questions/recent',
  status: 404,
  duration_ms: 2,
  request_id: '43370787-156f-42c6-bc2a-74c7077b47e0',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > HTTP Method Validation > should handle GET to POST-only endpoints appropriately
⚠️  04:48:11 WARN  [HTTP]       request: GET /sessions 401
   Data: {
  method: 'GET',
  path: '/sessions',
  status: 401,
  duration_ms: 1,
  request_id: '93ce50bf-7713-4f94-9a6e-97f247c33467',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Request Validation > should validate required fields in POST requests
⚠️  04:48:11 WARN  [HTTP]       request: POST /exchange-session 400
   Data: {
  method: 'POST',
  path: '/exchange-session',
  status: 400,
  duration_ms: 2,
  request_id: 'd1e8580b-db76-4999-bafe-31268371d431',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Response Format > should include error field in error responses
⚠️  04:48:11 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 1,
  request_id: 'bab3a883-f584-4701-904c-07ec540cb86f',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Health Endpoint Security > should not leak SUPABASE_SERVICE_ROLE_KEY in response
⚠️  04:48:11 WARN  [HTTP]       request: GET /health 401
   Data: {
  method: 'GET',
  path: '/health',
  status: 401,
  duration_ms: 1,
  request_id: 'fd954424-da73-44a1-a12f-96568022dbf3',
  user_id: null
}

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Health Endpoint Security > should require admin role for health endpoint
⚠️  04:48:11 WARN  [HTTP]       request: GET /health 401
   Data: {
  method: 'GET',
  path: '/health',
  status: 401,
  duration_ms: 0,
  request_id: '2e3ebe8e-b6f8-42f0-b685-b3c323dc0149',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should reject Authorization: Bearer header without cookie
⚠️  04:48:12 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 10,
  request_id: 'ca911dd6-56c9-4329-9400-590d4454a6f9',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should reject Authorization: Bearer header even with valid-looking token
⚠️  04:48:12 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 2,
  request_id: '72dd0992-36d4-4d50-aad9-bd3310ca177c',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should return 401 for protected routes without any auth
⚠️  04:48:12 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 1,
  request_id: '08c4db2d-b641-4b7b-ab4d-4b249c1e9b71',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should return 401 for missing sb-access-token cookie
⚠️  04:48:12 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 2,
  request_id: 'f2589f09-c734-4d15-b2aa-ef40f343b606',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/recent without auth
Error fetching recent questions (Supabase HTTP): {
  message: 'TypeError: fetch failed',
  details: 'TypeError: fetch failed\n' +
    '\n' +
    'Caused by: Error: getaddrinfo ENOTFOUND placeholder.supabase.co (ENOTFOUND)\n' +
    'Error: getaddrinfo ENOTFOUND placeholder.supabase.co\n' +
    '    at GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:122:26)',
  hint: '',
  code: ''
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/search without auth
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for profile (GET /api/profile)
⚠️  04:48:12 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 2,
  request_id: '6b0f006b-2584-4ba6-ba6c-d888f4808d2e',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for practice sessions (POST /api/practice/sessions)
⚠️  04:48:12 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 11,
  request_id: '48e5bea6-b57a-4177-b2f0-bd89941b1244',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for RAG endpoint (POST /api/rag)
⚠️  04:48:12 WARN  [HTTP]       request: POST /api/rag 401
   Data: {
  method: 'POST',
  path: '/api/rag',
  status: 401,
  duration_ms: 5,
  request_id: 'ae4f58fc-4932-4c90-9748-7c7f7585882d',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for Tutor v2 (POST /api/tutor/v2)
⚠️  04:48:12 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 1,
  request_id: '19ad801c-4c54-4d6f-91b5-fade8828002d',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should block POST /api/rag without Origin/Referer (CSRF protection)
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: '',
  originNorm: '',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should block POST /api/rag without Origin/Referer (CSRF protection)
⚠️  04:48:12 WARN  [HTTP]       request: POST /api/rag 403
   Data: {
  method: 'POST',
  path: '/api/rag',
  status: 403,
  duration_ms: 2,
  request_id: 'd219985c-d607-4bda-986f-3385eea8c3c6',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Admin Endpoints - Admin Auth Required > should return 401 for admin routes without auth
⚠️  04:48:12 WARN  [HTTP]       request: GET /questions/needs-review 401
   Data: {
  method: 'GET',
  path: '/questions/needs-review',
  status: 401,
  duration_ms: 1,
  request_id: '9190255e-7bb3-4d35-b658-41b2d48a8e14',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Token Security > should reject short/invalid tokens
⚠️  04:48:12 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 1,
  request_id: '2b911f24-9701-41cf-bf18-31b0fa7350d7',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie Security > should not set auth cookies on public endpoints
Error fetching recent questions (Supabase HTTP): {
  message: 'TypeError: fetch failed',
  details: 'TypeError: fetch failed\n' +
    '\n' +
    'Caused by: Error: getaddrinfo ENOTFOUND placeholder.supabase.co (ENOTFOUND)\n' +
    'Error: getaddrinfo ENOTFOUND placeholder.supabase.co\n' +
    '    at GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:122:26)',
  hint: '',
  code: ''
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Session Exchange Endpoint > should require tokens in exchange-session endpoint
⚠️  04:48:12 WARN  [HTTP]       request: POST /exchange-session 400
   Data: {
  method: 'POST',
  path: '/exchange-session',
  status: 400,
  duration_ms: 1,
  request_id: '9fc52aca-8874-4d36-9d00-b45888f125e7',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Session Exchange Endpoint > should validate token format in exchange-session
🚨 04:48:12 ERROR [AUTH]       exchange_session_error: Session exchange error
   Error details: {
  name: 'Error',
  message: 'supabaseUrl is required.',
  stack: 'Error: supabaseUrl is required.\n' +
    '    at validateSupabaseUrl (file:///workspace/Lyceonai/node_modules/.pnpm/@supabase+supabase-js@2.90.1_bufferutil@4.1.0/node_modules/@supabase/supabase-js/dist/index.mjs:150:25)\n' +
    '    at new SupabaseClient (file:///workspace/Lyceonai/node_modules/.pnpm/@supabase+supabase-js@2.90.1_bufferutil@4.1.0/node_modules/@supabase/supabase-js/dist/index.mjs:199:19)\n' +
    '    at createClient (file:///workspace/Lyceonai/node_modules/.pnpm/@supabase+supabase-js@2.90.1_bufferutil@4.1.0/node_modules/@supabase/supabase-js/dist/index.mjs:390:9)\n' +
    '    at /workspace/Lyceonai/server/routes/supabase-auth-routes.ts:556:22\n' +
    '    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)\n' +
    '    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)\n' +
    '    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)\n' +
    '    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)\n' +
    '    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15\n' +
    '    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)'
}
🚨 04:48:12 ERROR [HTTP]       request: POST /exchange-session 500
   Error details: {
  method: 'POST',
  path: '/exchange-session',
  status: 500,
  duration_ms: 5,
  request_id: 'b66c38ba-5dcd-414f-8768-50653bb0d39f',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Error Handling > should return 404 for non-existent API routes
⚠️  04:48:12 WARN  [HTTP]       request: GET /api/nonexistent 404
   Data: {
  method: 'GET',
  path: '/api/nonexistent',
  status: 404,
  duration_ms: 3,
  request_id: '2b0fc8e0-8393-4528-a060-1bd402756680',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Error Handling > should handle malformed JSON gracefully
⚠️  04:48:12 WARN  [HTTP]       request: POST /api/auth/exchange-session 400
   Data: {
  method: 'POST',
  path: '/api/auth/exchange-session',
  status: 400,
  duration_ms: 4,
  request_id: 'ceaebb6b-8cff-44ab-af53-0f73c0e7d168',
  user_id: null
}

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
Error in semantic search: Error: Missing GEMINI_API_KEY - required for embeddings and LLM
    at getGeminiClient (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:13:11)
    at generateEmbedding (/workspace/Lyceonai/apps/api/src/lib/embeddings.ts:24:18)
    at searchQuestions (/workspace/Lyceonai/apps/api/src/routes/search.ts:31:35)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)
    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)
    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:280:10)

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Missing Origin/Referer > should block POST requests without Origin/Referer (403)
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: '',
  originNorm: '',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 9,
  request_id: '80e54ceb-dca7-4519-bb43-7f92ed3c4993',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Missing Origin/Referer > should block POST to exchange-session without Origin/Referer
🚨 04:48:13 ERROR [AUTH]       exchange_session_error: Session exchange error
   Error details: {
  name: 'Error',
  message: 'supabaseUrl is required.',
  stack: 'Error: supabaseUrl is required.\n' +
    '    at validateSupabaseUrl (file:///workspace/Lyceonai/node_modules/.pnpm/@supabase+supabase-js@2.90.1_bufferutil@4.1.0/node_modules/@supabase/supabase-js/dist/index.mjs:150:25)\n' +
    '    at new SupabaseClient (file:///workspace/Lyceonai/node_modules/.pnpm/@supabase+supabase-js@2.90.1_bufferutil@4.1.0/node_modules/@supabase/supabase-js/dist/index.mjs:199:19)\n' +
    '    at createClient (file:///workspace/Lyceonai/node_modules/.pnpm/@supabase+supabase-js@2.90.1_bufferutil@4.1.0/node_modules/@supabase/supabase-js/dist/index.mjs:390:9)\n' +
    '    at /workspace/Lyceonai/server/routes/supabase-auth-routes.ts:556:22\n' +
    '    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)\n' +
    '    at next (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:149:13)\n' +
    '    at Route.dispatch (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/route.js:119:3)\n' +
    '    at Layer.handle [as handle_request] (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/layer.js:95:5)\n' +
    '    at /workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:284:15\n' +
    '    at Function.process_params (/workspace/Lyceonai/node_modules/.pnpm/express@4.22.1/node_modules/express/lib/router/index.js:346:12)'
}
🚨 04:48:13 ERROR [HTTP]       request: POST /exchange-session 500
   Error details: {
  method: 'POST',
  path: '/exchange-session',
  status: 500,
  duration_ms: 18,
  request_id: 'f2626dab-9ce1-47ef-9199-5493cacaa25a',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: https://evil.com
[CSRF] blocked {
  method: 'POST',
  origin: 'https://evil.com',
  referer: '',
  originNorm: 'https://evil.com',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: 'ac3227d9-3b1c-4838-aa17-3a178fd0d90b',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: http://localhost:5000.evil.com
[CSRF] blocked {
  method: 'POST',
  origin: 'http://localhost:5000.evil.com',
  referer: '',
  originNorm: 'http://localhost:5000.evil.com',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '8b01d966-3b43-4476-9251-452990dfd1db',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: http://evil.com
[CSRF] blocked {
  method: 'POST',
  origin: 'http://evil.com',
  referer: '',
  originNorm: 'http://evil.com',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '5e7043e1-1dbe-433a-abbf-2258687a1041',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: https://attacker.com
[CSRF] blocked {
  method: 'POST',
  origin: 'https://attacker.com',
  referer: '',
  originNorm: 'https://attacker.com',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 2,
  request_id: '504a6cab-c5c0-4f16-b1d1-d21d46c2e286',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block hostname-prefix impersonation (localhost:5000.evil.com)
[CSRF] blocked {
  method: 'POST',
  origin: 'http://localhost:5000.evil.com',
  referer: '',
  originNorm: 'http://localhost:5000.evil.com',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '71b85e13-f450-4a52-9f1d-73bb949003aa',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block subdomain impersonation via Referer
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: 'http://localhost:5000.attacker.com/path',
  originNorm: '',
  refererNorm: 'http://localhost:5000.attacker.com/path',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 2,
  request_id: 'b7eeb211-b31b-4ae4-84ce-2816b316fb24',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block trailing domain impersonation
[CSRF] blocked {
  method: 'POST',
  origin: 'http://evil.com/localhost:5000',
  referer: '',
  originNorm: 'http://evil.com',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: 'b35a1f43-7da2-44d1-9937-c454c16010ef',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Empty Origin Bypass Prevention > should not bypass CSRF with empty origin entries
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: '',
  originNorm: '',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: 'f063adb7-e847-4461-a682-7a9f98a23997',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Empty Origin Bypass Prevention > should block requests with only whitespace in Origin
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: '',
  originNorm: '',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:13 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '2f03e79d-d629-41aa-bea1-7c1a82b2ffe6',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET to public questions endpoint without Origin/Referer
Error fetching recent questions (Supabase HTTP): {
  message: 'TypeError: fetch failed',
  details: 'TypeError: fetch failed\n' +
    '\n' +
    'Caused by: Error: getaddrinfo ENOTFOUND placeholder.supabase.co (ENOTFOUND)\n' +
    'Error: getaddrinfo ENOTFOUND placeholder.supabase.co\n' +
    '    at GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:122:26)',
  hint: '',
  code: ''
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Protocol Variants > should block http origin when https is required
[CSRF] blocked {
  method: 'POST',
  origin: 'https://evil.com',
  referer: '',
  originNorm: 'https://evil.com',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:14 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '46a4ab2b-a4a0-48e7-8a20-4f07df15ac13',
  user_id: null
}

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Multiple Headers > should block when both Origin and Referer are invalid
[CSRF] blocked {
  method: 'POST',
  origin: 'https://evil.com',
  referer: 'https://attacker.com/path',
  originNorm: 'https://evil.com',
  refererNorm: 'https://attacker.com',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}
⚠️  04:48:14 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: 'f572cb20-3b88-4044-b2ce-e114980c5da9',
  user_id: null
}

stderr | tests/idor.regression.test.ts > IDOR Regression Invariants > tutor_v2_userid_from_auth_not_body
⚠️  04:48:15 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 32,
  request_id: '2b69d26b-8c40-468d-a776-0bf0ca3154f9',
  user_id: null
}

stderr | tests/idor.regression.test.ts > IDOR Regression Invariants > tutor_v2_userid_from_auth_not_body
⚠️  04:48:15 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 2,
  request_id: '8f16f5ff-927a-495b-93f3-9122bfcfa4be',
  user_id: null
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_cookie_only_api_rag_rejects_bearer
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: '',
  originNorm: '',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_cookie_only_api_rag_rejects_bearer
⚠️  04:48:17 WARN  [HTTP]       request: POST /api/rag 403
   Data: {
  method: 'POST',
  path: '/api/rag',
  status: 403,
  duration_ms: 19,
  request_id: '14cd6eab-6e41-4654-8f10-49205d5e8820',
  user_id: null
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_rag_v2_requires_cookie
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: '',
  originNorm: '',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_rag_v2_requires_cookie
⚠️  04:48:17 WARN  [HTTP]       request: POST / 403
   Data: {
  method: 'POST',
  path: '/',
  status: 403,
  duration_ms: 4,
  request_id: '578d743c-d3ab-4a1f-9287-651fc69c544b',
  user_id: null
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: '',
  originNorm: '',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
⚠️  04:48:17 WARN  [HTTP]       request: POST / 403
   Data: {
  method: 'POST',
  path: '/',
  status: 403,
  duration_ms: 13,
  request_id: '071aab1f-b832-4522-94b1-d146d034b83d',
  user_id: null
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
[CSRF] blocked {
  method: 'POST',
  origin: '',
  referer: '',
  originNorm: '',
  refererNorm: '',
  allowCount: 5,
  allowPreview: [
    'https://lyceon.ai',
    'https://www.lyceon.ai',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
⚠️  04:48:17 WARN  [HTTP]       request: POST / 403
   Data: {
  method: 'POST',
  path: '/',
  status: 403,
  duration_ms: 3,
  request_id: 'f9a915be-d6c3-4e36-bc67-cec7fc197c05',
  user_id: null
}

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > admin_db_health_requires_admin
⚠️  04:48:17 WARN  [HTTP]       request: GET /db-health 401
   Data: {
  method: 'GET',
  path: '/db-health',
  status: 401,
  duration_ms: 2,
  request_id: '78805eb6-9f2c-45c2-ac34-d152033610cb',
  user_id: null
}

stderr | tests/tutor.v2.regression.test.ts > Tutor V2 Security Regression > PRAC-002: rejects unauthenticated requests (no cookie)
⚠️  04:48:18 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 32,
  request_id: 'e536e9d6-5aed-47e5-ad40-ba40460b4ddc',
  user_id: null
}

stderr | tests/tutor.v2.regression.test.ts > Tutor V2 Security Regression > PRAC-002: rejects bearer auth (cookie-only endpoint)
⚠️  04:48:18 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 2,
  request_id: '368f3aa6-e520-4502-8938-7bd7d477508d',
  user_id: null
}

stderr | tests/practice.validate.regression.test.ts > Practice/Questions Validate Security Regression > PRAC-001: rejects unauthenticated requests (no cookie)
⚠️  04:48:21 WARN  [HTTP]       request: POST /api/questions/validate 401
   Data: {
  method: 'POST',
  path: '/api/questions/validate',
  status: 401,
  duration_ms: 18,
  request_id: '34d55bff-1b11-4f2f-8950-db1c13dfa05b',
  user_id: null
}

stderr | tests/practice.validate.regression.test.ts > Practice/Questions Validate Security Regression > PRAC-001: rejects bearer auth (cookie-only endpoint)
⚠️  04:48:21 WARN  [HTTP]       request: POST /api/questions/validate 401
   Data: {
  method: 'POST',
  path: '/api/questions/validate',
  status: 401,
  duration_ms: 3,
  request_id: '50bc7760-c8ba-4537-8ec1-07bb5cb57df4',
  user_id: null
}

```

## B) Mastery source of truth (schema + write choke point)

### Command
```bash
ls -la supabase/migrations || true
```

Output:
```text
total 144
drwxr-xr-x 2 root root  4096 Feb 11 04:45 .
drwxr-xr-x 3 root root  4096 Feb 11 04:45 ..
-rw-r--r-- 1 root root  7708 Feb 11 04:45 20241218_competency_tables.sql
-rw-r--r-- 1 root root  4070 Feb 11 04:45 20251222_add_canonical_id_to_questions.sql
-rw-r--r-- 1 root root   488 Feb 11 04:45 20251222_dedupe_canonical_id_indexes.sql
-rw-r--r-- 1 root root  1551 Feb 11 04:45 20251222_drop_internal_id_column.sql
-rw-r--r-- 1 root root  2157 Feb 11 04:45 20251222_questions_drop_internal_id_uniqueness.sql
-rw-r--r-- 1 root root  9079 Feb 11 04:45 20251222_student_mastery_tables.sql
-rw-r--r-- 1 root root  1634 Feb 11 04:45 20251223_legal_acceptances.sql
-rw-r--r-- 1 root root   674 Feb 11 04:45 20251227_enqueue_rpc_v2_wrapper.sql
-rw-r--r-- 1 root root  3425 Feb 11 04:45 20251227_study_calendar_tables.sql
-rw-r--r-- 1 root root 16005 Feb 11 04:45 20260102_guardian_link_code.sql
-rw-r--r-- 1 root root  8132 Feb 11 04:45 20260102_practice_tables.sql
-rw-r--r-- 1 root root  3460 Feb 11 04:45 20260108_sprint21_hardening.sql
-rw-r--r-- 1 root root  4775 Feb 11 04:45 20260109_practice_canonical.sql
-rw-r--r-- 1 root root  8246 Feb 11 04:45 20260110_practice_canonical_plus_events.sql
-rw-r--r-- 1 root root  4719 Feb 11 04:45 20260113_practice_engine_competencies.sql
-rw-r--r-- 1 root root   812 Feb 11 04:45 20260202_profile_completion_fields.sql
-rw-r--r-- 1 root root  3172 Feb 11 04:45 20260203_review_error_attempts.sql
-rw-r--r-- 1 root root 10120 Feb 11 04:45 20260210_mastery_v1.sql
-rw-r--r-- 1 root root 10428 Feb 11 04:45 20260211_mastery_constants.sql
```

### Command
```bash
rg -n "20260211_mastery_constants|mastery_constants" supabase/migrations
```

Output:
```text
supabase/migrations/20260211_mastery_constants.sql:8:-- 1. Create mastery_constants table with seeded values
supabase/migrations/20260211_mastery_constants.sql:14:-- Step 1: Create mastery_constants table
supabase/migrations/20260211_mastery_constants.sql:17:CREATE TABLE IF NOT EXISTS public.mastery_constants (
supabase/migrations/20260211_mastery_constants.sql:28:COMMENT ON TABLE public.mastery_constants IS 'Configuration constants for mastery calculation (True Half-Life formula)';
supabase/migrations/20260211_mastery_constants.sql:34:INSERT INTO public.mastery_constants (key, value_num, units, description, formula_ref) VALUES
supabase/migrations/20260211_mastery_constants.sql:41:INSERT INTO public.mastery_constants (key, value_json, description) VALUES
supabase/migrations/20260211_mastery_constants.sql:56:-- Step 3: RLS for mastery_constants
supabase/migrations/20260211_mastery_constants.sql:59:ALTER TABLE public.mastery_constants ENABLE ROW LEVEL SECURITY;
supabase/migrations/20260211_mastery_constants.sql:63:  ON public.mastery_constants
supabase/migrations/20260211_mastery_constants.sql:68:  ON public.mastery_constants
supabase/migrations/20260211_mastery_constants.sql:121:  -- Fetch constants from mastery_constants table
supabase/migrations/20260211_mastery_constants.sql:122:  SELECT value_num INTO v_half_life_days FROM public.mastery_constants WHERE key = 'HALF_LIFE_DAYS';
supabase/migrations/20260211_mastery_constants.sql:123:  SELECT value_num INTO v_alpha0 FROM public.mastery_constants WHERE key = 'ALPHA0';
supabase/migrations/20260211_mastery_constants.sql:124:  SELECT value_num INTO v_beta0 FROM public.mastery_constants WHERE key = 'BETA0';
supabase/migrations/20260211_mastery_constants.sql:219:  -- Fetch constants from mastery_constants table
supabase/migrations/20260211_mastery_constants.sql:220:  SELECT value_num INTO v_half_life_days FROM public.mastery_constants WHERE key = 'HALF_LIFE_DAYS';
supabase/migrations/20260211_mastery_constants.sql:221:  SELECT value_num INTO v_alpha0 FROM public.mastery_constants WHERE key = 'ALPHA0';
supabase/migrations/20260211_mastery_constants.sql:222:  SELECT value_num INTO v_beta0 FROM public.mastery_constants WHERE key = 'BETA0';
```

### Command
```bash
rg -n "student_skill_mastery|student_cluster_mastery|upsert_skill_mastery|upsert_cluster_mastery" supabase/migrations
```

Output:
```text
supabase/migrations/20251222_student_mastery_tables.sql:41:-- Table: student_skill_mastery
supabase/migrations/20251222_student_mastery_tables.sql:44:CREATE TABLE IF NOT EXISTS public.student_skill_mastery (
supabase/migrations/20251222_student_mastery_tables.sql:64:CREATE INDEX IF NOT EXISTS idx_skill_mastery_user_id ON public.student_skill_mastery(user_id);
supabase/migrations/20251222_student_mastery_tables.sql:65:CREATE INDEX IF NOT EXISTS idx_skill_mastery_user_section ON public.student_skill_mastery(user_id, section);
supabase/migrations/20251222_student_mastery_tables.sql:66:CREATE INDEX IF NOT EXISTS idx_skill_mastery_accuracy ON public.student_skill_mastery(user_id, accuracy ASC);
supabase/migrations/20251222_student_mastery_tables.sql:69:-- Table: student_cluster_mastery
supabase/migrations/20251222_student_mastery_tables.sql:72:CREATE TABLE IF NOT EXISTS public.student_cluster_mastery (
supabase/migrations/20251222_student_mastery_tables.sql:90:CREATE INDEX IF NOT EXISTS idx_cluster_mastery_user_id ON public.student_cluster_mastery(user_id);
supabase/migrations/20251222_student_mastery_tables.sql:91:CREATE INDEX IF NOT EXISTS idx_cluster_mastery_accuracy ON public.student_cluster_mastery(user_id, accuracy ASC);
supabase/migrations/20251222_student_mastery_tables.sql:97:ALTER TABLE public.student_skill_mastery ENABLE ROW LEVEL SECURITY;
supabase/migrations/20251222_student_mastery_tables.sql:98:ALTER TABLE public.student_cluster_mastery ENABLE ROW LEVEL SECURITY;
supabase/migrations/20251222_student_mastery_tables.sql:108:CREATE POLICY "Users can view own skill mastery" ON public.student_skill_mastery
supabase/migrations/20251222_student_mastery_tables.sql:111:CREATE POLICY "Users can manage own skill mastery" ON public.student_skill_mastery
supabase/migrations/20251222_student_mastery_tables.sql:115:CREATE POLICY "Users can view own cluster mastery" ON public.student_cluster_mastery
supabase/migrations/20251222_student_mastery_tables.sql:118:CREATE POLICY "Users can manage own cluster mastery" ON public.student_cluster_mastery
supabase/migrations/20251222_student_mastery_tables.sql:127:CREATE POLICY "Service role full access to skill mastery" ON public.student_skill_mastery
supabase/migrations/20251222_student_mastery_tables.sql:130:CREATE POLICY "Service role full access to cluster mastery" ON public.student_cluster_mastery
supabase/migrations/20251222_student_mastery_tables.sql:136:CREATE OR REPLACE FUNCTION public.upsert_skill_mastery(
supabase/migrations/20251222_student_mastery_tables.sql:152:  INSERT INTO public.student_skill_mastery (user_id, section, domain, skill, attempts, correct, accuracy, mastery_score, last_attempt_at, updated_at)
supabase/migrations/20251222_student_mastery_tables.sql:155:    attempts = student_skill_mastery.attempts + 1,
supabase/migrations/20251222_student_mastery_tables.sql:156:    correct = student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
supabase/migrations/20251222_student_mastery_tables.sql:157:    accuracy = (student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_skill_mastery.attempts + 1)::NUMERIC,
supabase/migrations/20251222_student_mastery_tables.sql:158:    mastery_score = (student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_skill_mastery.attempts + 1)::NUMERIC,
supabase/migrations/20251222_student_mastery_tables.sql:167:CREATE OR REPLACE FUNCTION public.upsert_cluster_mastery(
supabase/migrations/20251222_student_mastery_tables.sql:177:  INSERT INTO public.student_cluster_mastery (user_id, structure_cluster_id, attempts, correct, accuracy, mastery_score, last_attempt_at, updated_at)
supabase/migrations/20251222_student_mastery_tables.sql:180:    attempts = student_cluster_mastery.attempts + 1,
supabase/migrations/20251222_student_mastery_tables.sql:181:    correct = student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
supabase/migrations/20251222_student_mastery_tables.sql:182:    accuracy = (student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_cluster_mastery.attempts + 1)::NUMERIC,
supabase/migrations/20251222_student_mastery_tables.sql:183:    mastery_score = (student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_cluster_mastery.attempts + 1)::NUMERIC,
supabase/migrations/20251222_student_mastery_tables.sql:190:COMMENT ON TABLE public.student_skill_mastery IS 'Rollup of student accuracy by skill for weakness tracking';
supabase/migrations/20251222_student_mastery_tables.sql:191:COMMENT ON TABLE public.student_cluster_mastery IS 'Rollup of student accuracy by structure cluster for weakness tracking';
supabase/migrations/20260210_mastery_v1.sql:16:-- student_skill_mastery: Change mastery_score from NUMERIC(5,4) [0,1] to NUMERIC(5,2) [0,100]
supabase/migrations/20260210_mastery_v1.sql:18:ALTER TABLE public.student_skill_mastery 
supabase/migrations/20260210_mastery_v1.sql:21:UPDATE public.student_skill_mastery 
supabase/migrations/20260210_mastery_v1.sql:25:-- student_cluster_mastery: Same transformation
supabase/migrations/20260210_mastery_v1.sql:26:ALTER TABLE public.student_cluster_mastery 
supabase/migrations/20260210_mastery_v1.sql:29:UPDATE public.student_cluster_mastery 
supabase/migrations/20260210_mastery_v1.sql:113:-- Step 5: Update upsert_skill_mastery with Mastery v1.0 formula
supabase/migrations/20260210_mastery_v1.sql:116:CREATE OR REPLACE FUNCTION public.upsert_skill_mastery(
supabase/migrations/20260210_mastery_v1.sql:142:  FROM public.student_skill_mastery
supabase/migrations/20260210_mastery_v1.sql:167:  INSERT INTO public.student_skill_mastery (
supabase/migrations/20260210_mastery_v1.sql:185:    attempts = student_skill_mastery.attempts + 1,
supabase/migrations/20260210_mastery_v1.sql:186:    correct = student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
supabase/migrations/20260210_mastery_v1.sql:187:    accuracy = (student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC 
supabase/migrations/20260210_mastery_v1.sql:188:               / (student_skill_mastery.attempts + 1)::NUMERIC,
supabase/migrations/20260210_mastery_v1.sql:196:-- Step 6: Update upsert_cluster_mastery with Mastery v1.0 formula
supabase/migrations/20260210_mastery_v1.sql:199:CREATE OR REPLACE FUNCTION public.upsert_cluster_mastery(
supabase/migrations/20260210_mastery_v1.sql:223:  FROM public.student_cluster_mastery
supabase/migrations/20260210_mastery_v1.sql:241:  INSERT INTO public.student_cluster_mastery (
supabase/migrations/20260210_mastery_v1.sql:257:    attempts = student_cluster_mastery.attempts + 1,
supabase/migrations/20260210_mastery_v1.sql:258:    correct = student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
supabase/migrations/20260210_mastery_v1.sql:259:    accuracy = (student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC 
supabase/migrations/20260210_mastery_v1.sql:260:               / (student_cluster_mastery.attempts + 1)::NUMERIC,
supabase/migrations/20260210_mastery_v1.sql:273:COMMENT ON FUNCTION public.upsert_skill_mastery IS 'Updates skill mastery using Mastery v1.0 EMA formula: M_new = clamp(M_old + ALPHA * delta, 0, 100)';
supabase/migrations/20260210_mastery_v1.sql:274:COMMENT ON FUNCTION public.upsert_cluster_mastery IS 'Updates cluster mastery using Mastery v1.0 EMA formula: M_new = clamp(M_old + ALPHA * delta, 0, 100)';
supabase/migrations/20260211_mastery_constants.sql:75:-- student_skill_mastery: Change attempts/correct from INTEGER to NUMERIC
supabase/migrations/20260211_mastery_constants.sql:76:ALTER TABLE public.student_skill_mastery 
supabase/migrations/20260211_mastery_constants.sql:80:-- student_cluster_mastery: Change attempts/correct from INTEGER to NUMERIC
supabase/migrations/20260211_mastery_constants.sql:81:ALTER TABLE public.student_cluster_mastery 
supabase/migrations/20260211_mastery_constants.sql:86:-- Step 5: Update upsert_skill_mastery with True Half-Life formula
supabase/migrations/20260211_mastery_constants.sql:89:CREATE OR REPLACE FUNCTION public.upsert_skill_mastery(
supabase/migrations/20260211_mastery_constants.sql:129:  FROM public.student_skill_mastery
supabase/migrations/20260211_mastery_constants.sql:158:  INSERT INTO public.student_skill_mastery (
supabase/migrations/20260211_mastery_constants.sql:186:-- Step 6: Update upsert_cluster_mastery with True Half-Life formula
supabase/migrations/20260211_mastery_constants.sql:189:CREATE OR REPLACE FUNCTION public.upsert_cluster_mastery(
supabase/migrations/20260211_mastery_constants.sql:227:  FROM public.student_cluster_mastery
supabase/migrations/20260211_mastery_constants.sql:254:  INSERT INTO public.student_cluster_mastery (
supabase/migrations/20260211_mastery_constants.sql:283:COMMENT ON FUNCTION public.upsert_skill_mastery IS 'Updates skill mastery using True Half-Life formula: exponential decay of evidence (E,C) with Beta priors';
supabase/migrations/20260211_mastery_constants.sql:284:COMMENT ON FUNCTION public.upsert_cluster_mastery IS 'Updates cluster mastery using True Half-Life formula: exponential decay of evidence (E,C) with Beta priors';
```

### Command
```bash
rg -n "function applyMasteryUpdate|applyMasteryUpdate\(" apps/api/src server/routes
```

Output:
```text
server/routes/practice-canonical.ts:434:      await applyMasteryUpdate({
apps/api/src/services/mastery-write.ts:8: * ALL mastery updates MUST flow through applyMasteryUpdate().
apps/api/src/services/mastery-write.ts:78:export async function applyMasteryUpdate(input: AttemptInput): Promise<AttemptResult> {
apps/api/src/services/mastery-write.ts:190: * @deprecated Use applyMasteryUpdate() instead for clarity.
apps/api/src/services/studentMastery.ts:128: * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
apps/api/src/services/studentMastery.ts:166: * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
apps/api/src/services/studentMastery.ts:212: * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
apps/api/src/routes/diagnostic.ts:230:    const masteryResult = await applyMasteryUpdate({
```

### Command
```bash
rg -n "PRACTICE_SUBMIT|DIAGNOSTIC_SUBMIT|FULL_LENGTH_SUBMIT|TUTOR_VIEW|TUTOR_RETRY_SUBMIT" apps/api/src server/routes
```

Output:
```text
server/routes/practice-canonical.ts:430:  // MASTERY V1.0: Use PRACTICE_SUBMIT event type for proper weighting
server/routes/practice-canonical.ts:441:        eventType: MasteryEventType.PRACTICE_SUBMIT,
apps/api/src/services/mastery-write.ts:72: * - TUTOR_VIEW does not change mastery (no-op for mastery updates)
apps/api/src/services/mastery-write.ts:98:  // TUTOR_VIEW is a no-op for mastery - we still log the attempt but don't update mastery
apps/api/src/services/mastery-write.ts:99:  const shouldUpdateMastery = input.eventType !== MasteryEventType.TUTOR_VIEW;
apps/api/src/services/mastery-constants.ts:15:  PRACTICE_SUBMIT = 'PRACTICE_SUBMIT',
apps/api/src/services/mastery-constants.ts:16:  DIAGNOSTIC_SUBMIT = 'DIAGNOSTIC_SUBMIT',
apps/api/src/services/mastery-constants.ts:17:  FULL_LENGTH_SUBMIT = 'FULL_LENGTH_SUBMIT',
apps/api/src/services/mastery-constants.ts:18:  TUTOR_VIEW = 'TUTOR_VIEW',
apps/api/src/services/mastery-constants.ts:19:  TUTOR_RETRY_SUBMIT = 'TUTOR_RETRY_SUBMIT',
apps/api/src/services/mastery-constants.ts:75:  [MasteryEventType.PRACTICE_SUBMIT]: 1.00,
apps/api/src/services/mastery-constants.ts:76:  [MasteryEventType.DIAGNOSTIC_SUBMIT]: 1.25,
apps/api/src/services/mastery-constants.ts:77:  [MasteryEventType.FULL_LENGTH_SUBMIT]: 1.50,
apps/api/src/services/mastery-constants.ts:78:  [MasteryEventType.TUTOR_VIEW]: 0.00, // No mastery change
apps/api/src/services/mastery-constants.ts:79:  [MasteryEventType.TUTOR_RETRY_SUBMIT]: 0.75,
apps/api/src/routes/diagnostic.ts:229:    // CRITICAL: Use DIAGNOSTIC_SUBMIT event type for proper weighting
apps/api/src/routes/diagnostic.ts:237:      eventType: MasteryEventType.DIAGNOSTIC_SUBMIT,
```

### Command
```bash
rg -n '\.from\(["'"'"']student_skill_mastery["'"'"']\).*\.(insert|update|upsert|delete)' apps/api/src server/routes
```

Output:
```text
```

### Command
```bash
rg -n '\.from\(["'"'"']student_cluster_mastery["'"'"']\).*\.(insert|update|upsert|delete)' apps/api/src server/routes
```

Output:
```text
```

### Command
```bash
rg -n 'supabase\.rpc\(["'"'"']upsert_skill_mastery["'"'"']' apps/api/src server/routes
```

Output:
```text
apps/api/src/services/mastery-write.ts:135:      const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
```

### Command
```bash
rg -n 'supabase\.rpc\(["'"'"']upsert_cluster_mastery["'"'"']' apps/api/src server/routes
```

Output:
```text
apps/api/src/services/mastery-write.ts:161:      const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
```

### Command
```bash
rg -n 'MasteryEventType\.(PRACTICE_SUBMIT|DIAGNOSTIC_SUBMIT|FULL_LENGTH_SUBMIT|TUTOR_VIEW|TUTOR_RETRY_SUBMIT)' apps/api/src server/routes
```

Output:
```text
server/routes/practice-canonical.ts:441:        eventType: MasteryEventType.PRACTICE_SUBMIT,
apps/api/src/services/mastery-write.ts:99:  const shouldUpdateMastery = input.eventType !== MasteryEventType.TUTOR_VIEW;
apps/api/src/services/mastery-constants.ts:75:  [MasteryEventType.PRACTICE_SUBMIT]: 1.00,
apps/api/src/services/mastery-constants.ts:76:  [MasteryEventType.DIAGNOSTIC_SUBMIT]: 1.25,
apps/api/src/services/mastery-constants.ts:77:  [MasteryEventType.FULL_LENGTH_SUBMIT]: 1.50,
apps/api/src/services/mastery-constants.ts:78:  [MasteryEventType.TUTOR_VIEW]: 0.00, // No mastery change
apps/api/src/services/mastery-constants.ts:79:  [MasteryEventType.TUTOR_RETRY_SUBMIT]: 0.75,
apps/api/src/routes/diagnostic.ts:237:      eventType: MasteryEventType.DIAGNOSTIC_SUBMIT,
```

## C) True Half-Life persisted in DB

### Command
```bash
rg -n "FROM public\.mastery_constants|mastery_constants WHERE key" supabase/migrations/20260211_mastery_constants.sql
```

Output:
```text
122:  SELECT value_num INTO v_half_life_days FROM public.mastery_constants WHERE key = 'HALF_LIFE_DAYS';
123:  SELECT value_num INTO v_alpha0 FROM public.mastery_constants WHERE key = 'ALPHA0';
124:  SELECT value_num INTO v_beta0 FROM public.mastery_constants WHERE key = 'BETA0';
220:  SELECT value_num INTO v_half_life_days FROM public.mastery_constants WHERE key = 'HALF_LIFE_DAYS';
221:  SELECT value_num INTO v_alpha0 FROM public.mastery_constants WHERE key = 'ALPHA0';
222:  SELECT value_num INTO v_beta0 FROM public.mastery_constants WHERE key = 'BETA0';
```

### Command
```bash
rg -n "DECAY_RATE\s*=\s*0\.95|0\.95\s*\^|weeksInactive" server/services/score-projection.ts
```

Output:
```text
```

### Command
```bash
rg -n "HALF_LIFE" apps/api/src/services/mastery-projection.ts
```

Output:
```text
```

## D) Mastery scale normalization

### Command
```bash
rg -n "mastery_score.*0, 100|round\(100 \* p" supabase/migrations/20260211_mastery_constants.sql
```

Output:
```text
154:  -- Convert to mastery_score on [0, 100] scale
250:  -- Convert to mastery_score on [0, 100] scale
```

### Command
```bash
rg -n "normalize.*mastery|mastery_score\s*/\s*100" server/services/score-projection.ts
```

Output:
```text
86:function normalizeMasteryScore(masteryScore: number): number {
```

## E) Diagnostic baseline determinism

### Command
```bash
rg -n "DIAGNOSTIC_TOTAL_QUESTIONS\s*=\s*20|diag_v1" apps/api/src/services apps/api/src/routes supabase/migrations
```

Output:
```text
supabase/migrations/20260210_mastery_v1.sql:40:  blueprint_version VARCHAR(32) NOT NULL DEFAULT 'diag_v1',
apps/api/src/services/mastery-constants.ts:104:export const DIAGNOSTIC_TOTAL_QUESTIONS = 20;
apps/api/src/services/mastery-constants.ts:116:export const DIAGNOSTIC_BLUEPRINT_VERSION = 'diag_v1';
```

### Command
```bash
rg -n "domains\.sort\(|difficulty_bucket|exclude|lookback" apps/api/src/services/diagnostic-service.ts
```

Output:
```text
69:    const domains = taxonomy.domains.sort(); // Deterministic order
103:  const lookbackDate = new Date();
104:  lookbackDate.setDate(lookbackDate.getDate() - DIAGNOSTIC_LOOKBACK_DAYS);
110:    .gte('attempted_at', lookbackDate.toISOString());
134:    .select('canonical_id, difficulty_bucket, id')
138:    .order('difficulty_bucket', { ascending: true })
```

## F) Edge-case tests exist

### Command
```bash
rg -n "Deep Freeze|Perfect Prodigy|Underflow|Event Weight" tests apps/api/test || true
```

Output:
```text
tests/mastery.true-halflife.edgecases.test.ts:14: * 1. Deep Freeze: high p + huge dt → p regresses toward prior mean
tests/mastery.true-halflife.edgecases.test.ts:15: * 2. Perfect Prodigy: 1000 correct → p approaches 1.0 (but not exactly)
tests/mastery.true-halflife.edgecases.test.ts:16: * 3. Event Weight Bias: different event weights yield equivalent p
tests/mastery.true-halflife.edgecases.test.ts:17: * 4. Underflow: single attempt + 500 days → stable, no NaN/Infinity
tests/mastery.true-halflife.edgecases.test.ts:80:  describe("1. Deep Freeze - Regression to Prior Mean", () => {
tests/mastery.true-halflife.edgecases.test.ts:131:  describe("2. Perfect Prodigy - Asymptotic Approach to p=1", () => {
tests/mastery.true-halflife.edgecases.test.ts:182:  describe("3. Event Weight Bias - Equivalent Impact", () => {
tests/mastery.true-halflife.edgecases.test.ts:245:  describe("4. Underflow - Single Attempt + Long Gap", () => {
```

### Command
```bash
rg -n "mastery\.true-halflife\.edgecases" -S . || true
```

Output:
```text
./docs/audits/sprint-3/P00_MASTERY_TRUE_HALFLIFE_PR3.md:76: ✓ tests/mastery.true-halflife.edgecases.test.ts (13 tests) 7ms
./docs/audits/sprint-3/P00_MASTERY_TRUE_HALFLIFE_PR3.md:317:**File:** `tests/mastery.true-halflife.edgecases.test.ts`
./docs/audits/sprint-3/P00_MASTERY_TRUE_HALFLIFE_PR3.md:523:$ pnpm test tests/mastery.true-halflife.edgecases.test.ts
```
