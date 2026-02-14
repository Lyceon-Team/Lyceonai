# P00 Exams Current State Proofs (Sprint 4)

## Mandatory repo grounding outputs (verbatim)

```bash
$ pwd
/workspace/Lyceonai

$ git rev-parse --show-toplevel
/workspace/Lyceonai

$ git rev-parse --abbrev-ref HEAD
work

$ git status --porcelain
?? docs/audits/sprint-4/

$ node -v
v22.21.1

$ pnpm -v
10.13.1

$ pnpm -s run build
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
✓ built in 9.80s
Building server with esbuild...
Entry: /workspace/Lyceonai/server/index.ts
Output: /workspace/Lyceonai/dist/index.js

  dist/index.js      384.3kb
  dist/index.js.map  769.0kb

⚡ Done in 172ms
✓ Server bundle created at /workspace/Lyceonai/dist/index.js
✓ All local files bundled, all npm packages external

$ pnpm test

> rest-express@1.0.0 test /workspace/Lyceonai
> vitest run

 DEPRECATED  `test.poolOptions` was removed in Vitest 4. All previous `poolOptions` are now top-level options. Please, refer to the migration guide: https://vitest.dev/guide/migration#pool-rework

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
ℹ️  04:49:26 INFO  [HTTP]       request: GET /api/health 200
   Data: {
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration_ms: 6,
  request_id: '9e5e0d48-a929-4421-ac2a-12ac67c87c8c',
  user_id: null
}
GET /api/health 200 7ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Recent questions (GET /api/questions/recent?limit=5) should be accessible without auth
[SUPABASE-HTTP] Test mode: using placeholder client

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

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Recent questions (GET /api/questions/recent?limit=5) should be accessible without auth
ℹ️  04:49:27 INFO  [HTTP]       request: GET /api/questions/recent 200
   Data: {
  method: 'GET',
  path: '/api/questions/recent',
  status: 200,
  duration_ms: 79,
  request_id: '28b6191a-312c-4903-820f-52d937227bd5',
  user_id: null
}
GET /api/questions/recent 200 79ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Search questions (GET /api/questions/search?q=test) should be accessible without auth
[SUPABASE] Test mode: using placeholder client
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Search questions (GET /api/questions/search?q=test) should be accessible without auth
ℹ️  04:49:27 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 5,
  request_id: '4021629c-332e-4b18-95e1-f47f8762b841',
  user_id: null
}
GET /api/questions/search 200 5ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > Get auth user (GET /api/auth/user) should be accessible without auth
ℹ️  04:49:27 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 2,
  request_id: '071a2878-6536-4a84-97f5-9a5b11c49d08',
  user_id: null
}
GET /user 200 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Public Routes - No Auth Required > should return user as null for unauthenticated /api/auth/user requests
ℹ️  04:49:27 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 2,
  request_id: '66d60d42-e30a-4d70-8b6c-1f1e3845e8b1',
  user_id: null
}
GET /user 200 2ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > User profile (GET /api/profile) should require authentication
GET /api/profile 401 2ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > User profile (GET /api/profile) should require authentication
⚠️  04:49:27 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 2,
  request_id: '9a89ddf2-d0a8-47db-9ea5-fd635a448dc6',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > RAG endpoint (POST /api/rag) should require authentication
POST /api/rag 401 15ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > RAG endpoint (POST /api/rag) should require authentication
⚠️  04:49:27 WARN  [HTTP]       request: POST /api/rag 401
   Data: {
  method: 'POST',
  path: '/api/rag',
  status: 401,
  duration_ms: 15,
  request_id: '31b75c27-9f82-4916-9e94-118ac32cdada',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > RAG v2 endpoint (POST /api/rag/v2) should require authentication
POST / 401 2ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > RAG v2 endpoint (POST /api/rag/v2) should require authentication
⚠️  04:49:27 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 2,
  request_id: '07aea21d-c15e-4f95-a5a7-33f95548bf49',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > Tutor v2 (POST /api/tutor/v2) should require authentication
POST / 401 3ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > Tutor v2 (POST /api/tutor/v2) should require authentication
⚠️  04:49:27 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 2,
  request_id: 'dc908fda-7fdc-4125-af9b-e14c3a3a65fe',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > Practice sessions (POST /api/practice/sessions) should require authentication
POST /sessions 401 3ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Protected Routes - Auth Required > Practice sessions (POST /api/practice/sessions) should require authentication
⚠️  04:49:27 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 2,
  request_id: '6d389cf3-2118-49cd-a416-dcc398512b05',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Routes - Admin Auth Required > Questions needing review (GET /api/admin/questions/needs-review) should require authentication
GET /questions/needs-review 401 2ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Routes - Admin Auth Required > Questions needing review (GET /api/admin/questions/needs-review) should require authentication
⚠️  04:49:27 WARN  [HTTP]       request: GET /questions/needs-review 401
   Data: {
  method: 'GET',
  path: '/questions/needs-review',
  status: 401,
  duration_ms: 2,
  request_id: '4c45b25b-e391-4d26-b021-036e2ecfab69',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Routes - Admin Auth Required > Admin health endpoint (GET /api/admin/health) should require authentication
GET /health 401 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Routes - Admin Auth Required > Admin health endpoint (GET /api/admin/health) should require authentication
⚠️  04:49:27 WARN  [HTTP]       request: GET /health 401
   Data: {
  method: 'GET',
  path: '/health',
  status: 401,
  duration_ms: 1,
  request_id: 'db80b850-8f57-4695-893a-7eeda3c99341',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > User Identity Derivation > should derive user ID from auth token, not request body
POST /sessions 401 2ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > User Identity Derivation > should derive user ID from auth token, not request body
⚠️  04:49:27 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 2,
  request_id: 'd4c862eb-7a01-4f0f-acd9-1270350a0682',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > User Identity Derivation > should not accept user_id in query parameters for auth bypass
GET /api/profile 401 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > User Identity Derivation > should not accept user_id in query parameters for auth bypass
⚠️  04:49:27 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 0,
  request_id: '9ecd4ce8-5050-4667-80fa-21a3d41df8ba',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > FERPA Compliance - Under-13 Consent > should require authentication for practice endpoints (FERPA check)
POST /sessions 401 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > FERPA Compliance - Under-13 Consent > should require authentication for practice endpoints (FERPA check)
⚠️  04:49:27 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 1,
  request_id: '507c1404-ec69-4062-905c-63a11191a09f',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Role-Based Access Control > should reject unauthenticated access to student-only routes
POST /sessions 401 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Role-Based Access Control > should reject unauthenticated access to student-only routes
⚠️  04:49:27 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 1,
  request_id: '14bd9393-1a3e-4dd2-a4a8-134a12e80b4c',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Role-Based Access Control > should reject unauthenticated access to guardian routes
GET /students 401 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Role-Based Access Control > should reject unauthenticated access to guardian routes
⚠️  04:49:27 WARN  [HTTP]       request: GET /students 401
   Data: {
  method: 'GET',
  path: '/students',
  status: 401,
  duration_ms: 1,
  request_id: '7bc3e916-1cfc-48cd-b9fb-e8ede3af8696',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > HTTP Method Validation > should reject POST to GET-only endpoints
POST /api/questions/recent 404 3ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > HTTP Method Validation > should reject POST to GET-only endpoints
⚠️  04:49:27 WARN  [HTTP]       request: POST /api/questions/recent 404
   Data: {
  method: 'POST',
  path: '/api/questions/recent',
  status: 404,
  duration_ms: 3,
  request_id: '4b7e7deb-f0f5-4527-81b4-969aad93e4a9',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > HTTP Method Validation > should handle GET to POST-only endpoints appropriately
GET /sessions 401 0ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > HTTP Method Validation > should handle GET to POST-only endpoints appropriately
⚠️  04:49:27 WARN  [HTTP]       request: GET /sessions 401
   Data: {
  method: 'GET',
  path: '/sessions',
  status: 401,
  duration_ms: 0,
  request_id: '4f7c7792-7351-47c4-a48c-77df40f3bdcb',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Request Validation > should validate required fields in POST requests
POST /exchange-session 400 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Request Validation > should validate required fields in POST requests
⚠️  04:49:27 WARN  [HTTP]       request: POST /exchange-session 400
   Data: {
  method: 'POST',
  path: '/exchange-session',
  status: 400,
  duration_ms: 1,
  request_id: 'ad8e30a1-5920-49ca-b728-4498fac47dad',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Response Format > should return JSON for API endpoints
ℹ️  04:49:27 INFO  [HTTP]       request: GET /api/health 200
   Data: {
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration_ms: 0,
  request_id: 'f5b4ae92-54cf-4f89-a988-d61c3c0da798',
  user_id: null
}
GET /api/health 200 0ms

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Response Format > should include error field in error responses
GET /api/profile 401 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Response Format > should include error field in error responses
⚠️  04:49:27 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 1,
  request_id: '44f5463c-30ce-41b5-a5ab-02dbdda9adf0',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Health Endpoint Security > should not leak SUPABASE_SERVICE_ROLE_KEY in response
GET /health 401 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Health Endpoint Security > should not leak SUPABASE_SERVICE_ROLE_KEY in response
⚠️  04:49:27 WARN  [HTTP]       request: GET /health 401
   Data: {
  method: 'GET',
  path: '/health',
  status: 401,
  duration_ms: 1,
  request_id: '33be8064-f4a2-4342-bb1f-9cd899fab9e8',
  user_id: null
}

stdout | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Health Endpoint Security > should require admin role for health endpoint
GET /health 401 1ms

stderr | tests/ci/routes.ci.test.ts > CI Routes Tests > Admin Health Endpoint Security > should require admin role for health endpoint
⚠️  04:49:27 WARN  [HTTP]       request: GET /health 401
   Data: {
  method: 'GET',
  path: '/health',
  status: 401,
  duration_ms: 1,
  request_id: '7881c551-53f0-42bf-9746-86c4e5d139a4',
  user_id: null
}

 ✓ tests/ci/routes.ci.test.ts (24 tests) 1715ms
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
GET /api/profile 401 7ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should reject Authorization: Bearer header without cookie
⚠️  04:49:28 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 6,
  request_id: '8724f898-9168-448c-bbc6-793bcd2fc6ea',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should reject Authorization: Bearer header even with valid-looking token
GET /api/profile 401 1ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should reject Authorization: Bearer header even with valid-looking token
⚠️  04:49:28 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 1,
  request_id: '35f3a090-b2b3-4003-975a-f40b5a9d461d',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should return 401 for protected routes without any auth
GET /api/profile 401 1ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should return 401 for protected routes without any auth
⚠️  04:49:28 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 0,
  request_id: '2e53aab1-1580-4469-96ab-69686c439d39',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should return 401 for missing sb-access-token cookie
GET /api/profile 401 1ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie-Only Authentication > should return 401 for missing sb-access-token cookie
⚠️  04:49:28 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 1,
  request_id: 'cfc5f8b9-6bf6-43f5-b467-ec7095dbb454',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/health without auth
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/health 200
   Data: {
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration_ms: 1,
  request_id: 'f704ce89-07f6-49fe-b440-bd985d22908f',
  user_id: null
}
GET /api/health 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/recent without auth
[SUPABASE-HTTP] Test mode: using placeholder client

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/recent without auth
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/recent 200
   Data: {
  method: 'GET',
  path: '/api/questions/recent',
  status: 200,
  duration_ms: 56,
  request_id: '36a7c124-133a-4f07-8f6e-d2f1a1ce0bb3',
  user_id: null
}
GET /api/questions/recent 200 56ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/search without auth
[SUPABASE] Test mode: using placeholder client
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should allow access to /api/questions/search without auth
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 7,
  request_id: '2cdec2ce-ef69-4374-b908-b8e64c6096d4',
  user_id: null
}
GET /api/questions/search 200 7ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Public Endpoints - No Auth Required > should return user as null for /api/auth/user without auth
ℹ️  04:49:28 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 1,
  request_id: 'c4007be4-9a3a-4c6e-8b0c-c95a3b838315',
  user_id: null
}
GET /user 200 1ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for profile (GET /api/profile)
GET /api/profile 401 2ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for profile (GET /api/profile)
⚠️  04:49:28 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 2,
  request_id: 'e234690b-bb6d-4ce8-aeed-3b3fdb90e98e',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for practice sessions (POST /api/practice/sessions)
POST /sessions 401 13ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for practice sessions (POST /api/practice/sessions)
⚠️  04:49:28 WARN  [HTTP]       request: POST /sessions 401
   Data: {
  method: 'POST',
  path: '/sessions',
  status: 401,
  duration_ms: 12,
  request_id: 'e93ff6c9-7573-423d-a141-d6c983d8cd24',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for RAG endpoint (POST /api/rag)
POST /api/rag 401 6ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for RAG endpoint (POST /api/rag)
⚠️  04:49:28 WARN  [HTTP]       request: POST /api/rag 401
   Data: {
  method: 'POST',
  path: '/api/rag',
  status: 401,
  duration_ms: 6,
  request_id: '39ec2cea-68f1-4999-854e-bcf012341323',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for Tutor v2 (POST /api/tutor/v2)
POST / 401 2ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should require auth for Tutor v2 (POST /api/tutor/v2)
⚠️  04:49:28 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 2,
  request_id: 'f52407cc-d79b-4bcc-8df5-4e89502676d1',
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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should block POST /api/rag without Origin/Referer (CSRF protection)
POST /api/rag 403 2ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Protected Endpoints - Auth Required > should block POST /api/rag without Origin/Referer (CSRF protection)
⚠️  04:49:28 WARN  [HTTP]       request: POST /api/rag 403
   Data: {
  method: 'POST',
  path: '/api/rag',
  status: 403,
  duration_ms: 1,
  request_id: '143dc75f-0ee5-4c59-a029-03fde81ea4bf',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Admin Endpoints - Admin Auth Required > should return 401 for admin routes without auth
GET /questions/needs-review 401 2ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Admin Endpoints - Admin Auth Required > should return 401 for admin routes without auth
⚠️  04:49:28 WARN  [HTTP]       request: GET /questions/needs-review 401
   Data: {
  method: 'GET',
  path: '/questions/needs-review',
  status: 401,
  duration_ms: 1,
  request_id: '10a03012-380c-470b-821b-f87ee9d5e926',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Token Security > should not expose tokens in /api/auth/user response
ℹ️  04:49:28 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 1,
  request_id: '64e83a76-7372-458c-b485-24deceb0acfa',
  user_id: null
}
GET /user 200 1ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Token Security > should reject short/invalid tokens
GET /api/profile 401 1ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Token Security > should reject short/invalid tokens
⚠️  04:49:28 WARN  [HTTP]       request: GET /api/profile 401
   Data: {
  method: 'GET',
  path: '/api/profile',
  status: 401,
  duration_ms: 1,
  request_id: '40017e60-573d-4955-93ef-ac3bfd821231',
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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Cookie Security > should not set auth cookies on public endpoints
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/recent 200
   Data: {
  method: 'GET',
  path: '/api/questions/recent',
  status: 200,
  duration_ms: 62,
  request_id: '4d09364c-2bc3-4f3f-9153-b50a72e4ee91',
  user_id: null
}
GET /api/questions/recent 200 63ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Session Exchange Endpoint > should require tokens in exchange-session endpoint
POST /exchange-session 400 1ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Session Exchange Endpoint > should require tokens in exchange-session endpoint
⚠️  04:49:28 WARN  [HTTP]       request: POST /exchange-session 400
   Data: {
  method: 'POST',
  path: '/exchange-session',
  status: 400,
  duration_ms: 1,
  request_id: '58486066-5b77-419d-a027-d001c60e989f',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Session Exchange Endpoint > should validate token format in exchange-session
POST /exchange-session 500 4ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Session Exchange Endpoint > should validate token format in exchange-session
🚨 04:49:28 ERROR [AUTH]       exchange_session_error: Session exchange error
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
🚨 04:49:28 ERROR [HTTP]       request: POST /exchange-session 500
   Error details: {
  method: 'POST',
  path: '/exchange-session',
  status: 500,
  duration_ms: 4,
  request_id: '76c480f7-f1c4-43fb-976e-a73612de82ec',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Error Handling > should return 404 for non-existent API routes
GET /api/nonexistent 404 3ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Error Handling > should return 404 for non-existent API routes
⚠️  04:49:28 WARN  [HTTP]       request: GET /api/nonexistent 404
   Data: {
  method: 'GET',
  path: '/api/nonexistent',
  status: 404,
  duration_ms: 3,
  request_id: 'b9ad0023-97e9-4b75-8fe5-b8ab68fe7992',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Error Handling > should handle malformed JSON gracefully
POST /api/auth/exchange-session 400 3ms

stderr | tests/ci/auth.ci.test.ts > CI Auth Tests > Error Handling > should handle malformed JSON gracefully
⚠️  04:49:28 WARN  [HTTP]       request: POST /api/auth/exchange-session 400
   Data: {
  method: 'POST',
  path: '/api/auth/exchange-session',
  status: 400,
  duration_ms: 3,
  request_id: '23f5d19f-312b-4f48-99b1-2038a8d0a604',
  user_id: null
}

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '6a73d29c-9910-41c3-b2cf-532b8f8b2af7',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '6759e11e-f733-4482-854a-2355bfaaf200',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 1,
  request_id: 'feaac518-05ae-41c3-95b9-7b3ed89e3020',
  user_id: null
}
GET /api/questions/search 200 1ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: 'b7eaefad-75cd-48e1-a23e-6f299852b8df',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '63e4603e-2c0a-4c23-a39d-4085b5d08ef7',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: 'fb27c42b-9fbc-4db9-9ad4-afbd420dab0c',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 1,
  request_id: '6970bc6b-c03e-46a7-a6a4-3fbe41e0ec6d',
  user_id: null
}
GET /api/questions/search 200 1ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '99326a9f-0caf-460b-9392-59bc943713b5',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 2,
  request_id: '83c7a562-be8f-43f3-8533-8fb44ba38c54',
  user_id: null
}
GET /api/questions/search 200 2ms

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
🔍 Generating embedding for query: "test"

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

stdout | tests/ci/auth.ci.test.ts > CI Auth Tests > Rate Limiting > should have rate limiting on search endpoint
ℹ️  04:49:28 INFO  [HTTP]       request: GET /api/questions/search 200
   Data: {
  method: 'GET',
  path: '/api/questions/search',
  status: 200,
  duration_ms: 1,
  request_id: '1ea0148b-0b9b-4c77-8cd6-203a903a0bbf',
  user_id: null
}
GET /api/questions/search 200 1ms

 ✓ tests/ci/auth.ci.test.ts (22 tests) 844ms
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
POST /signout 403 8ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 7,
  request_id: '9aa9e948-86af-4f22-b675-66b122465374',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Missing Origin/Referer > should block POST to exchange-session without Origin/Referer
POST /exchange-session 500 17ms

stderr | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Missing Origin/Referer > should block POST to exchange-session without Origin/Referer
🚨 04:49:29 ERROR [AUTH]       exchange_session_error: Session exchange error
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
🚨 04:49:29 ERROR [HTTP]       request: POST /exchange-session 500
   Error details: {
  method: 'POST',
  path: '/exchange-session',
  status: 500,
  duration_ms: 16,
  request_id: '82aa2906-cfc4-45eb-afc3-648a9034b7ad',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Valid Origins > should allow POST with valid Origin: http://localhost:5000
ℹ️  04:49:29 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:49:29 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 2,
  request_id: '53c084b9-74e0-4a5c-aece-52272f3a7f06',
  user_id: null
}
POST /signout 200 3ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Valid Origins > should allow POST with valid Origin: http://localhost:3000
ℹ️  04:49:29 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:49:29 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 2,
  request_id: 'ed321b82-7373-4fab-8e15-db2ee7018d09',
  user_id: null
}
POST /signout 200 2ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Valid Origins > should allow POST with valid Referer header
ℹ️  04:49:29 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:49:29 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 2,
  request_id: 'fb6f5fd5-5a4e-46bb-a767-068706f51474',
  user_id: null
}
POST /signout 200 2ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: https://evil.com
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '64b58dbb-0113-46f8-8ed8-19bcb8e244a8',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: http://localhost:5000.evil.com
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '3d0bff6d-e12b-45cc-b8a4-5f1ae2568b32',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: http://evil.com
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '0e120f5a-43fe-4b71-8c53-b74ce03968b3',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Invalid Origins > should block POST with invalid Origin: https://attacker.com
POST /signout 403 2ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 2,
  request_id: '04390cfa-94fd-40b2-913b-61c663af70db',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block hostname-prefix impersonation (localhost:5000.evil.com)
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '3bcfeeb6-2b36-4ec1-9e22-78882e1d6759',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block subdomain impersonation via Referer
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '27f25339-b98e-4450-a025-efe02b3f6bff',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Prefix Attacks > should block trailing domain impersonation
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: 'dd3a4115-d5c9-4da9-bf2d-0ba35c258be0',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Empty Origin Bypass Prevention > should not bypass CSRF with empty origin entries
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '96b19bec-e87a-436c-9b0f-986206e1d3af',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Empty Origin Bypass Prevention > should block requests with only whitespace in Origin
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '9354deb9-d313-4a58-9fc1-b17e6a234369',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET requests without Origin/Referer
ℹ️  04:49:29 INFO  [HTTP]       request: GET /api/health 200
   Data: {
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration_ms: 0,
  request_id: '55e02ec9-cd26-446f-9646-4ddeaf823be3',
  user_id: null
}
GET /api/health 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET to /api/auth/user without Origin/Referer
ℹ️  04:49:29 INFO  [HTTP]       request: GET /user 200
   Data: {
  method: 'GET',
  path: '/user',
  status: 200,
  duration_ms: 1,
  request_id: '1e170368-b7e9-4267-9264-8c244fa9912e',
  user_id: null
}
GET /user 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET to public questions endpoint without Origin/Referer
[SUPABASE-HTTP] Test mode: using placeholder client

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

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - GET Requests > should allow GET to public questions endpoint without Origin/Referer
ℹ️  04:49:29 INFO  [HTTP]       request: GET /api/questions/recent 200
   Data: {
  method: 'GET',
  path: '/api/questions/recent',
  status: 200,
  duration_ms: 59,
  request_id: 'b03fe4ed-2d1e-4741-aeec-edb1969a0bcb',
  user_id: null
}
GET /api/questions/recent 200 59ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - HEAD and OPTIONS Requests > should allow HEAD requests without Origin/Referer
ℹ️  04:49:29 INFO  [HTTP]       request: HEAD /api/health 200
   Data: {
  method: 'HEAD',
  path: '/api/health',
  status: 200,
  duration_ms: 0,
  request_id: 'bcdef02b-360d-4a43-93b9-1a925a04a97c',
  user_id: null
}
HEAD /api/health 200 0ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - HEAD and OPTIONS Requests > should allow OPTIONS requests without Origin/Referer
ℹ️  04:49:29 INFO  [HTTP]       request: OPTIONS /api/health 204
   Data: {
  method: 'OPTIONS',
  path: '/api/health',
  status: 204,
  duration_ms: 1,
  request_id: 'f4707eb7-3c8e-4dd5-ba4a-579c0cb7646e',
  user_id: null
}
OPTIONS /api/health 204 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Case Sensitivity > should handle Origin header case-insensitively
ℹ️  04:49:29 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:49:29 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 1,
  request_id: '42c33af2-75e1-4a15-a020-707aace3c08d',
  user_id: null
}
POST /signout 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Protocol Variants > should block http origin when https is required
POST /signout 403 1ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 1,
  request_id: '527cfbce-36bb-4cc1-972e-7d781ce45ed8',
  user_id: null
}

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Multiple Headers > should validate Origin when both Origin and Referer are present
ℹ️  04:49:29 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:49:29 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 1,
  request_id: 'cc9326ff-7980-4194-8fe3-9943f46f8fba',
  user_id: null
}
POST /signout 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Multiple Headers > should allow request if either Origin OR Referer is valid
ℹ️  04:49:29 INFO  [AUTH]       signout_success: User signed out
   Data: { userId: undefined }
ℹ️  04:49:29 INFO  [HTTP]       request: POST /signout 200
   Data: {
  method: 'POST',
  path: '/signout',
  status: 200,
  duration_ms: 0,
  request_id: 'f741b010-0b9f-4719-a650-314b04d61c55',
  user_id: null
}
POST /signout 200 1ms

stdout | tests/ci/security.ci.test.ts > CI Security Tests - CSRF > CSRF Protection - Multiple Headers > should block when both Origin and Referer are invalid
POST /signout 403 0ms

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
⚠️  04:49:29 WARN  [HTTP]       request: POST /signout 403
   Data: {
  method: 'POST',
  path: '/signout',
  status: 403,
  duration_ms: 0,
  request_id: '4aefb238-a247-4998-8f9e-e3640443a1e1',
  user_id: null
}

 ✓ tests/ci/security.ci.test.ts (24 tests) 675ms
 ✓ apps/api/test/mastery-writepaths.guard.test.ts (3 tests) 144ms
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
POST / 401 27ms

stderr | tests/idor.regression.test.ts > IDOR Regression Invariants > tutor_v2_userid_from_auth_not_body
⚠️  04:49:30 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 26,
  request_id: 'f9d8364c-4291-4006-9f0c-3f883c195ddd',
  user_id: null
}

stdout | tests/idor.regression.test.ts > IDOR Regression Invariants > tutor_v2_userid_from_auth_not_body
POST / 401 3ms

stderr | tests/idor.regression.test.ts > IDOR Regression Invariants > tutor_v2_userid_from_auth_not_body
⚠️  04:49:30 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 3,
  request_id: '2ea084e6-f109-43c7-a1fe-c5b910d6a1f2',
  user_id: null
}

stdout | tests/idor.regression.test.ts > IDOR Regression Invariants > progress_review_attempt_rejects_foreign_session
[SUPABASE-HTTP] Client initialized

 ✓ tests/idor.regression.test.ts (2 tests) 89ms
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

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_cookie_only_api_rag_rejects_bearer
POST /api/rag 403 18ms

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_cookie_only_api_rag_rejects_bearer
⚠️  04:49:31 WARN  [HTTP]       request: POST /api/rag 403
   Data: {
  method: 'POST',
  path: '/api/rag',
  status: 403,
  duration_ms: 18,
  request_id: 'efb42df7-ecb8-4adf-89bb-6c21106d0716',
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

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_rag_v2_requires_cookie
POST / 403 2ms

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > auth_rag_v2_requires_cookie
⚠️  04:49:31 WARN  [HTTP]       request: POST / 403
   Data: {
  method: 'POST',
  path: '/',
  status: 403,
  duration_ms: 2,
  request_id: 'c47e2779-9a54-4232-8ce3-69e986ba688d',
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

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
POST / 403 13ms

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
⚠️  04:49:31 WARN  [HTTP]       request: POST / 403
   Data: {
  method: 'POST',
  path: '/',
  status: 403,
  duration_ms: 13,
  request_id: 'ae454663-6c1c-4076-aef5-363eb2510fa4',
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

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
POST / 403 2ms

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > rag_v2_userid_from_auth_not_body
⚠️  04:49:31 WARN  [HTTP]       request: POST / 403
   Data: {
  method: 'POST',
  path: '/',
  status: 403,
  duration_ms: 2,
  request_id: '5a410d2d-ffaa-49d2-9c47-f0ea0f17a5e9',
  user_id: null
}

stdout | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > admin_db_health_requires_admin
GET /db-health 401 3ms

stderr | tests/entitlements.regression.test.ts > Entitlement/Auth Regression Invariants > admin_db_health_requires_admin
⚠️  04:49:32 WARN  [HTTP]       request: GET /db-health 401
   Data: {
  method: 'GET',
  path: '/db-health',
  status: 401,
  duration_ms: 2,
  request_id: '982710b7-3af0-4b99-865a-35b184396792',
  user_id: null
}

 ✓ tests/entitlements.regression.test.ts (4 tests) 92ms
 ✓ tests/mastery.writepaths.guard.test.ts (3 tests) 102ms
 ✓ client/src/__tests__/toaster.guard.test.tsx (1 test) 61ms
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
POST /api/questions/validate 401 17ms

stderr | tests/practice.validate.regression.test.ts > Practice/Questions Validate Security Regression > PRAC-001: rejects unauthenticated requests (no cookie)
⚠️  04:49:35 WARN  [HTTP]       request: POST /api/questions/validate 401
   Data: {
  method: 'POST',
  path: '/api/questions/validate',
  status: 401,
  duration_ms: 16,
  request_id: 'c065e938-e94b-4bd1-8910-984aa37687b6',
  user_id: null
}

stdout | tests/practice.validate.regression.test.ts > Practice/Questions Validate Security Regression > PRAC-001: rejects bearer auth (cookie-only endpoint)
POST /api/questions/validate 401 3ms

stderr | tests/practice.validate.regression.test.ts > Practice/Questions Validate Security Regression > PRAC-001: rejects bearer auth (cookie-only endpoint)
⚠️  04:49:35 WARN  [HTTP]       request: POST /api/questions/validate 401
   Data: {
  method: 'POST',
  path: '/api/questions/validate',
  status: 401,
  duration_ms: 3,
  request_id: 'c421e899-b496-4458-8acc-ee15f0d9beef',
  user_id: null
}

 ✓ tests/practice.validate.regression.test.ts (2 tests) 60ms
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
POST / 401 28ms

stderr | tests/tutor.v2.regression.test.ts > Tutor V2 Security Regression > PRAC-002: rejects unauthenticated requests (no cookie)
⚠️  04:49:35 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 27,
  request_id: 'b59e2e5e-e6b9-4404-9620-7460d8afab8d',
  user_id: null
}

stdout | tests/tutor.v2.regression.test.ts > Tutor V2 Security Regression > PRAC-002: rejects bearer auth (cookie-only endpoint)
POST / 401 2ms

stderr | tests/tutor.v2.regression.test.ts > Tutor V2 Security Regression > PRAC-002: rejects bearer auth (cookie-only endpoint)
⚠️  04:49:36 WARN  [HTTP]       request: POST / 401
   Data: {
  method: 'POST',
  path: '/',
  status: 401,
  duration_ms: 2,
  request_id: '397e4afd-0a52-42ce-b861-5ef65452e164',
  user_id: null
}

 ✓ tests/tutor.v2.regression.test.ts (2 tests) 62ms
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

 ✓ apps/api/src/services/__tests__/adaptiveSelector.test.ts (9 tests) 59ms
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

 ✓ apps/api/test/rag-service.test.ts (22 tests) 38ms
 ✓ client/src/__tests__/useShortcuts.guard.test.tsx (1 test) 25ms
 ✓ apps/api/src/lib/__tests__/canonicalId.test.ts (19 tests) 26ms
 ✓ tests/mastery.true-halflife.edgecases.test.ts (13 tests) 20ms

 Test Files  15 passed (15)
      Tests  151 passed (151)
   Start at  04:49:25
   Duration  14.02s (transform 1.33s, setup 0ms, import 4.19s, tests 4.01s, environment 1.85s)

```

## A) Authoritative DB tables — command outputs

```bash
$ ls -la infra/supabase/migrations
ls: cannot access 'infra/supabase/migrations': No such file or directory

$ rg -n "test_sessions|test_forms|test_form_items|exam_|sat_score_tables|score_tables" infra/supabase/migrations
rg: infra/supabase/migrations: No such file or directory (os error 2)

$ rg -n "create policy|alter table .* enable row level security" infra/supabase/migrations
rg: infra/supabase/migrations: No such file or directory (os error 2)

# Repo uses supabase/migrations in this branch:
$ ls -la supabase/migrations
total 144
drwxr-xr-x 2 root root  4096 Feb 11 04:46 .
drwxr-xr-x 3 root root  4096 Feb 11 04:44 ..
-rw-r--r-- 1 root root  7708 Feb 11 04:44 20241218_competency_tables.sql
-rw-r--r-- 1 root root  4070 Feb 11 04:44 20251222_add_canonical_id_to_questions.sql
-rw-r--r-- 1 root root   488 Feb 11 04:44 20251222_dedupe_canonical_id_indexes.sql
-rw-r--r-- 1 root root  1551 Feb 11 04:44 20251222_drop_internal_id_column.sql
-rw-r--r-- 1 root root  2157 Feb 11 04:44 20251222_questions_drop_internal_id_uniqueness.sql
-rw-r--r-- 1 root root  9079 Feb 11 04:44 20251222_student_mastery_tables.sql
-rw-r--r-- 1 root root  1634 Feb 11 04:44 20251223_legal_acceptances.sql
-rw-r--r-- 1 root root   674 Feb 11 04:44 20251227_enqueue_rpc_v2_wrapper.sql
-rw-r--r-- 1 root root  3425 Feb 11 04:44 20251227_study_calendar_tables.sql
-rw-r--r-- 1 root root 16005 Feb 11 04:44 20260102_guardian_link_code.sql
-rw-r--r-- 1 root root  8132 Feb 11 04:44 20260102_practice_tables.sql
-rw-r--r-- 1 root root  3460 Feb 11 04:44 20260108_sprint21_hardening.sql
-rw-r--r-- 1 root root  4775 Feb 11 04:44 20260109_practice_canonical.sql
-rw-r--r-- 1 root root  8246 Feb 11 04:44 20260110_practice_canonical_plus_events.sql
-rw-r--r-- 1 root root  4719 Feb 11 04:44 20260113_practice_engine_competencies.sql
-rw-r--r-- 1 root root   812 Feb 11 04:46 20260202_profile_completion_fields.sql
-rw-r--r-- 1 root root  3172 Feb 11 04:46 20260203_review_error_attempts.sql
-rw-r--r-- 1 root root 10120 Feb 11 04:46 20260210_mastery_v1.sql
-rw-r--r-- 1 root root 10428 Feb 11 04:46 20260211_mastery_constants.sql

$ rg -n "test_sessions|test_forms|test_form_items|exam_|sat_score_tables|score_tables" supabase/migrations
supabase/migrations/20251227_study_calendar_tables.sql:13:  exam_date DATE,
supabase/migrations/20251227_study_calendar_tables.sql:22:CREATE INDEX IF NOT EXISTS idx_study_profile_exam_date
supabase/migrations/20251227_study_calendar_tables.sql:23:  ON public.student_study_profile(exam_date);
supabase/migrations/20260102_practice_tables.sql:143:  exam_date DATE,

$ rg -n "create policy|alter table .* enable row level security" supabase/migrations
```

## B) API surface map — command outputs

```bash
$ rg -n "api/tests|/tests|test_sessions|test_forms|sat_score_tables" apps/api/src

$ rg -n "router\.(get|post|put|delete)\(" apps/api/src/routes
apps/api/src/routes/diagnostic.ts:26:router.post('/start', async (req: AuthenticatedRequest, res: Response) => {
apps/api/src/routes/diagnostic.ts:57:router.get('/next', async (req: AuthenticatedRequest, res: Response) => {
apps/api/src/routes/diagnostic.ts:144:router.post('/answer', async (req: AuthenticatedRequest, res: Response) => {
apps/api/src/routes/rag-v2.ts:31:router.post('/', async (req: Request, res: Response) => {
apps/api/src/routes/rag.ts:70:router.post('/', rag);
apps/api/src/routes/tutor-v2.ts:198:router.post("/", async (req: Request, res: Response) => {
apps/api/src/routes/weakness.ts:11:router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {
apps/api/src/routes/weakness.ts:39:router.get('/clusters', async (req: AuthenticatedRequest, res: Response) => {
apps/api/src/routes/mastery.ts:162:router.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
apps/api/src/routes/mastery.ts:192:router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {
apps/api/src/routes/mastery.ts:290:router.get('/weakest', async (req: AuthenticatedRequest, res: Response) => {
apps/api/src/routes/mastery.ts:323:router.post('/add-to-plan', async (req: AuthenticatedRequest, res: Response) => {

$ rg -n "entitlement|requireEntitlement|requireStudent|guardian|roles" apps/api/src
apps/api/src/routes/question-feedback.ts:16:  role: 'student' | 'admin' | 'guardian';
apps/api/src/routes/calendar.ts:394:    // app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter);
apps/api/src/routes/questions.ts:538:    // Defensive: Only allow via requireSupabaseAuth, requireStudentOrAdmin, but double-check user/role
apps/api/src/routes/questions.ts:543:    const isGuardian = authUser?.isGuardian || role === 'guardian';
apps/api/src/routes/questions.ts:545:    // Defensive: guardians never get answers
```

## C) Anti-leak enforcement — command outputs

```bash
$ rg -n "correct_answer|explanation" apps/api/src
apps/api/src/lib/profile-service.ts:5:  updates: { secondaryStyle?: string; explanationLevel?: number }
apps/api/src/lib/profile-service.ts:14:    typeof updates.explanationLevel === "number" &&
apps/api/src/lib/profile-service.ts:15:    updates.explanationLevel >= 1 &&
apps/api/src/lib/profile-service.ts:16:    updates.explanationLevel <= 3
apps/api/src/lib/profile-service.ts:18:    patch.explanation_level = updates.explanationLevel;
apps/api/src/lib/rag-types.ts:36:  explanationLevel?: 1 | 2 | 3; // 1 = brief, 2 = moderate, 3 = detailed
apps/api/src/lib/rag-types.ts:48:  explanation: string | null;
apps/api/src/lib/rag-types.ts:112:    explanationLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
apps/api/src/lib/tutor-log.ts:9:  explanationLevel?: number | null;
apps/api/src/lib/tutor-log.ts:21:      explanation_level: params.explanationLevel,
apps/api/src/lib/rag-service.ts:482:        .select('overall_level, primary_style, secondary_style, explanation_level, competency_map, persona_tags, learning_prefs')
apps/api/src/lib/rag-service.ts:553:        explanationLevel: profileRow?.explanation_level ?? 2,
apps/api/src/lib/rag-service.ts:575:        explanationLevel: 2,
apps/api/src/lib/rag-service.ts:625:      explanation: row.explanation || null,
apps/api/src/lib/rag-service.ts:958:      explanation: row.explanation || null,
apps/api/src/routes/diagnostic.ts:99:    // Fetch full question data (without answer/explanation)
apps/api/src/routes/diagnostic.ts:187:        explanation,
apps/api/src/routes/diagnostic.ts:257:      explanation: isCorrect ? null : (question.explanation || null), // Show explanation on wrong answers
apps/api/src/routes/rag-v2.ts:72:            explanationLevel: validation.data.studentProfile.explanationLevel,
apps/api/src/routes/search.ts:80:        explanation: question.explanation,
apps/api/src/routes/questions.ts:28:    explanation: q.explanation ?? null,
apps/api/src/routes/questions.ts:89:        explanation,
apps/api/src/routes/questions.ts:151:        explanation,
apps/api/src/routes/questions.ts:240:                explanation,
apps/api/src/routes/questions.ts:326:        explanation,
apps/api/src/routes/questions.ts:479:        explanation,
apps/api/src/routes/questions.ts:559:      .select(`id, question_type, type, answer_choice, answer_text, answer, explanation`)
apps/api/src/routes/questions.ts:590:    // Only admins can always see correct answer/explanation
apps/api/src/routes/questions.ts:643:    // Response: only include explanation if allowed
apps/api/src/routes/questions.ts:650:      explanation: canSeeExplanation ? (question.explanation ?? null) : null,
apps/api/src/routes/questions.ts:677:        explanation,
apps/api/src/routes/questions.ts:872:        explanation,
apps/api/src/routes/questions.ts:898:      explanation: q.explanation,
apps/api/src/routes/questions.ts:939:        explanation,
apps/api/src/routes/questions.ts:965:      explanation: q.explanation,
apps/api/src/routes/admin-questions.ts:285:        explanation: reason ? `REJECTED: ${reason}` : 'REJECTED',
apps/api/src/routes/admin-questions.ts:323:      explanation: 'explanation',
apps/api/src/routes/tutor-v2.ts:41:    explanationLevel: number | null;
apps/api/src/routes/tutor-v2.ts:56:  if (level === null) return "Use a normal high school level explanation.";
apps/api/src/routes/tutor-v2.ts:61:      return "Use a normal high school level explanation with clear reasoning.";
apps/api/src/routes/tutor-v2.ts:65:      return "Use a normal high school level explanation.";
apps/api/src/routes/tutor-v2.ts:78:  // Do NOT include answer or explanation here; handled by reveal policy in handler
apps/api/src/routes/tutor-v2.ts:93:      return "Use step-by-step explanations, breaking down each part clearly.";
apps/api/src/routes/tutor-v2.ts:103:      return `Use a ${style} approach to explanations.`;
apps/api/src/routes/tutor-v2.ts:114:  const explanationLevelText = mapExplanationLevel(studentProfile?.explanationLevel || null);
apps/api/src/routes/tutor-v2.ts:151:      studentContext += `\n- The student prefers ${studentProfile.primaryStyle} explanations.`;
apps/api/src/routes/tutor-v2.ts:167:${explanationLevelText}`;
apps/api/src/routes/tutor-v2.ts:226:    // Only allow answer/explanation if admin or verified submission exists
apps/api/src/routes/tutor-v2.ts:246:    // Remove answer/explanation if not allowed
apps/api/src/routes/tutor-v2.ts:248:      primaryQuestion = { ...primaryQuestion, answer: null, explanation: null };
apps/api/src/routes/tutor-v2.ts:252:      supportingQuestions = supportingQuestions.map(q => ({ ...q, answer: null, explanation: null }));
apps/api/src/routes/tutor-v2.ts:268:    const currentExplanationLevel = studentProfile?.explanationLevel || 2;
apps/api/src/routes/tutor-v2.ts:286:          explanationLevel: newExplanationLevel,
apps/api/src/routes/tutor-v2.ts:303:        explanationLevel: finalExplanationLevel,
apps/api/src/routes/tutor-v2.ts:319:        explanationLevel: finalExplanationLevel,
apps/api/src/services/questionMapper.ts:22:    correct_answer: q.correct_answer,
apps/api/src/services/questionMapper.ts:23:    explanation: q.explanation,
apps/api/src/services/adaptiveSelector.ts:246:      explanation,
apps/api/src/services/adaptiveSelector.ts:519:    explanation: q.explanation ?? null,

$ rg -n "null" apps/api/src | rg "correct_answer|explanation"
apps/api/src/lib/rag-types.ts:48:  explanation: string | null;
apps/api/src/lib/tutor-log.ts:9:  explanationLevel?: number | null;
apps/api/src/lib/rag-service.ts:625:      explanation: row.explanation || null,
apps/api/src/lib/rag-service.ts:958:      explanation: row.explanation || null,
apps/api/src/routes/diagnostic.ts:257:      explanation: isCorrect ? null : (question.explanation || null), // Show explanation on wrong answers
apps/api/src/routes/questions.ts:28:    explanation: q.explanation ?? null,
apps/api/src/routes/questions.ts:650:      explanation: canSeeExplanation ? (question.explanation ?? null) : null,
apps/api/src/routes/tutor-v2.ts:41:    explanationLevel: number | null;
apps/api/src/routes/tutor-v2.ts:56:  if (level === null) return "Use a normal high school level explanation.";
apps/api/src/routes/tutor-v2.ts:114:  const explanationLevelText = mapExplanationLevel(studentProfile?.explanationLevel || null);
apps/api/src/routes/tutor-v2.ts:248:      primaryQuestion = { ...primaryQuestion, answer: null, explanation: null };
apps/api/src/routes/tutor-v2.ts:252:      supportingQuestions = supportingQuestions.map(q => ({ ...q, answer: null, explanation: null }));
apps/api/src/services/adaptiveSelector.ts:519:    explanation: q.explanation ?? null,

$ rg -n "review" apps/api/src/routes apps/api/src
apps/api/src/routes/questions.ts:710:// GET /api/review-errors - Get user's failed question attempts from most recent session
apps/api/src/routes/questions.ts:813:    // Build reviewQueue: concatenated array with questionId, outcome, attemptId
apps/api/src/routes/questions.ts:815:    const reviewQueue = [...incorrectRaw, ...skippedRaw]
apps/api/src/routes/questions.ts:827:      reviewQueue,
apps/api/src/routes/questions.ts:840:    console.error('Error fetching review errors:', error);
apps/api/src/lib/question-validation.ts:9:  'needs_review', 'confidence', 'created_at', 'updated_at'
apps/api/src/routes/progress.ts:11:export function getCompetencyDelta(source: 'practice' | 'review', eventType: 'correct' | 'incorrect' | 'skipped'): number {
apps/api/src/routes/progress.ts:57:  source: 'practice' | 'review',
apps/api/src/routes/progress.ts:102:          if (source === 'review') {
apps/api/src/routes/progress.ts:103:            updates.review_incorrect_count = (existing.review_incorrect_count || 0) + 1;
apps/api/src/routes/progress.ts:125:            review_incorrect_count: eventType === 'incorrect' && source === 'review' ? 1 : 0,
apps/api/src/routes/progress.ts:377:// POST /api/review-errors/attempt - Record review attempt competency event
apps/api/src/routes/progress.ts:421:      'review',
apps/api/src/routes/progress.ts:428:      delta: getCompetencyDelta('review', eventType as 'correct' | 'incorrect' | 'skipped'),
apps/api/src/routes/progress.ts:431:    console.error('Error recording review attempt:', error);
apps/api/src/routes/progress.ts:432:    res.status(500).json({ error: 'Failed to record review attempt' });
apps/api/src/routes/admin-questions.ts:5: * - Question review queue (needs_review filter)
apps/api/src/routes/admin-questions.ts:16: * GET /api/admin/questions/needs-review
apps/api/src/routes/admin-questions.ts:17: * Get questions that need manual review
apps/api/src/routes/admin-questions.ts:25:    // Get questions with needs_review = true
apps/api/src/routes/admin-questions.ts:29:      .eq('needs_review', true)
apps/api/src/routes/admin-questions.ts:35:      return res.status(500).json({ error: 'Failed to get questions needing review' });
apps/api/src/routes/admin-questions.ts:79:    res.status(500).json({ error: 'Failed to get questions needing review' });
apps/api/src/routes/admin-questions.ts:155: * Get question review statistics
apps/api/src/routes/admin-questions.ts:167:      .eq('needs_review', true);
apps/api/src/routes/admin-questions.ts:172:      .eq('needs_review', false);
apps/api/src/routes/admin-questions.ts:247:        needs_review: false,
apps/api/src/routes/admin-questions.ts:284:        needs_review: true, // Keep flagged
apps/api/src/routes/admin-questions.ts:326:      needsReview: 'needs_review',
apps/api/src/routes/admin-questions.ts:421:        needs_review: false,
apps/api/src/routes/questions.ts:710:// GET /api/review-errors - Get user's failed question attempts from most recent session
apps/api/src/routes/questions.ts:813:    // Build reviewQueue: concatenated array with questionId, outcome, attemptId
apps/api/src/routes/questions.ts:815:    const reviewQueue = [...incorrectRaw, ...skippedRaw]
apps/api/src/routes/questions.ts:827:      reviewQueue,
apps/api/src/routes/questions.ts:840:    console.error('Error fetching review errors:', error);
apps/api/src/middleware/cors.ts:30:          allowPreview: Array.from(normalized).slice(0, 8),
apps/api/src/routes/progress.ts:11:export function getCompetencyDelta(source: 'practice' | 'review', eventType: 'correct' | 'incorrect' | 'skipped'): number {
apps/api/src/routes/progress.ts:57:  source: 'practice' | 'review',
apps/api/src/routes/progress.ts:102:          if (source === 'review') {
apps/api/src/routes/progress.ts:103:            updates.review_incorrect_count = (existing.review_incorrect_count || 0) + 1;
apps/api/src/routes/progress.ts:125:            review_incorrect_count: eventType === 'incorrect' && source === 'review' ? 1 : 0,
apps/api/src/routes/progress.ts:377:// POST /api/review-errors/attempt - Record review attempt competency event
apps/api/src/routes/progress.ts:421:      'review',
apps/api/src/routes/progress.ts:428:      delta: getCompetencyDelta('review', eventType as 'correct' | 'incorrect' | 'skipped'),
apps/api/src/routes/progress.ts:431:    console.error('Error recording review attempt:', error);
apps/api/src/routes/progress.ts:432:    res.status(500).json({ error: 'Failed to record review attempt' });
apps/api/src/routes/admin-questions.ts:5: * - Question review queue (needs_review filter)
apps/api/src/routes/admin-questions.ts:16: * GET /api/admin/questions/needs-review
apps/api/src/routes/admin-questions.ts:17: * Get questions that need manual review
apps/api/src/routes/admin-questions.ts:25:    // Get questions with needs_review = true
apps/api/src/routes/admin-questions.ts:29:      .eq('needs_review', true)
apps/api/src/routes/admin-questions.ts:35:      return res.status(500).json({ error: 'Failed to get questions needing review' });
apps/api/src/routes/admin-questions.ts:79:    res.status(500).json({ error: 'Failed to get questions needing review' });
apps/api/src/routes/admin-questions.ts:155: * Get question review statistics
apps/api/src/routes/admin-questions.ts:167:      .eq('needs_review', true);
apps/api/src/routes/admin-questions.ts:172:      .eq('needs_review', false);
apps/api/src/routes/admin-questions.ts:247:        needs_review: false,
apps/api/src/routes/admin-questions.ts:284:        needs_review: true, // Keep flagged
apps/api/src/routes/admin-questions.ts:326:      needsReview: 'needs_review',
apps/api/src/routes/admin-questions.ts:421:        needs_review: false,
apps/api/src/services/adaptiveSelector.ts:254:      needs_review,
apps/api/src/services/adaptiveSelector.ts:258:    .not("needs_review", "is", true);
apps/api/src/services/diagnostic-service.ts:137:    .eq('needs_review', false) // Only active/servable questions
apps/api/src/services/__tests__/adaptiveSelector.test.ts:16:    needs_review: false,
apps/api/src/services/__tests__/adaptiveSelector.test.ts:30:    needs_review: false,
apps/api/src/services/__tests__/adaptiveSelector.test.ts:47:    needs_review: false,
```

## D) Timing model — command outputs

```bash
$ rg -n "started_at|completed_at|submitted_at|time_remaining|expires|deadline|timeout" apps/api/src
apps/api/src/types/mastery.ts:23:  completed_at: string | null;
apps/api/src/routes/admin-logs.ts:40:        query = query.gte('started_at', fromDate);
apps/api/src/routes/admin-logs.ts:43:        query = query.lte('started_at', toDate);
apps/api/src/routes/admin-logs.ts:47:        .order('started_at', { ascending: false })
apps/api/src/routes/admin-logs.ts:203:        .gte('started_at', yesterday),
apps/api/src/routes/calendar.ts:66:      .select("duration_minutes, started_at, finished_at")
apps/api/src/routes/calendar.ts:68:      .gte("started_at", utcStart)
apps/api/src/routes/calendar.ts:69:      .lte("started_at", utcEnd);
apps/api/src/routes/calendar.ts:80:      } else if (session.started_at && session.finished_at) {
apps/api/src/routes/calendar.ts:81:        const startTime = new Date(session.started_at).getTime();
apps/api/src/routes/questions.ts:721:      .select('id, started_at, mode, section')
apps/api/src/routes/questions.ts:723:      .order('started_at', { ascending: false })
apps/api/src/routes/questions.ts:830:        sessionStartedAt: recentSession.started_at,
apps/api/src/services/diagnostic-service.ts:202:    .select('id, question_ids, current_index, completed_at')
apps/api/src/services/diagnostic-service.ts:204:    .is('completed_at', null)
apps/api/src/services/diagnostic-service.ts:274:    .select('question_ids, current_index, completed_at')
apps/api/src/services/diagnostic-service.ts:288:  if (session.completed_at) {
apps/api/src/services/diagnostic-service.ts:339:    .select('student_id, question_ids, current_index, completed_at')
apps/api/src/services/diagnostic-service.ts:352:  if (session.completed_at) {
apps/api/src/services/diagnostic-service.ts:404:      completed_at: isComplete ? new Date().toISOString() : null,
apps/api/src/routes/progress.ts:569:      .gte('started_at', weekStartUtc)
apps/api/src/routes/progress.ts:570:      .lte('started_at', weekEndUtc);
```

## E) Scoring pipeline — command outputs

```bash
$ rg -n "scaled|raw_score|sat_score_tables|conversion|score table" apps/api/src infra/supabase supabase
rg: infra/supabase: No such file or directory (os error 2)
apps/api/src/routes/mastery.ts:37:          "unit_conversions",

$ rg -n "domain|skill" apps/api/src | rg "score|breakdown|test"
apps/api/src/routes/progress.ts:442: * - Recalculate mastery_score (uses stored values from student_skill_mastery)
apps/api/src/routes/progress.ts:458:      .select('section, domain, skill, mastery_score, attempts, updated_at')
apps/api/src/routes/progress.ts:484:      domainMastery[key].mastery_score = Math.max(
apps/api/src/routes/progress.ts:485:        domainMastery[key].mastery_score,
apps/api/src/routes/mastery.ts:185: * Returns full skill tree with mastery status computed from STORED mastery scores.
apps/api/src/routes/mastery.ts:204:      .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
apps/api/src/routes/mastery.ts:248:          domainTotalMastery += mastery_score;
apps/api/src/services/mastery-write.ts:65: * 3. Updates student_skill_mastery via RPC (if metadata available and event is scored)
apps/api/src/services/studentMastery.ts:137:    .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
apps/api/src/services/__tests__/adaptiveSelector.test.ts:11:    domain: 'Algebra',
apps/api/src/services/__tests__/adaptiveSelector.test.ts:12:    skill: 'Linear equations',
apps/api/src/services/__tests__/adaptiveSelector.test.ts:25:    domain: 'Geometry',
apps/api/src/services/__tests__/adaptiveSelector.test.ts:26:    skill: 'Circles',
apps/api/src/services/__tests__/adaptiveSelector.test.ts:42:    domain: 'Reading Comprehension',
apps/api/src/services/__tests__/adaptiveSelector.test.ts:43:    skill: 'Main Idea',
apps/api/src/services/__tests__/adaptiveSelector.test.ts:126:  it('should use skill mode when specified', async () => {
apps/api/src/services/__tests__/adaptiveSelector.test.ts:128:      { section: 'math', domain: 'Algebra', skill: 'Linear equations', accuracy: 0.4, attempts: 10, correct: 4, mastery_score: 0.4 },
apps/api/src/services/__tests__/adaptiveSelector.test.ts:135:      target: { mode: 'skill' },
apps/api/src/services/__tests__/adaptiveSelector.test.ts:138:    expect(result.rationale.mode).toBe('skill');
```

## F) Mastery integration discipline — command outputs

```bash
$ rg -n "applyMasteryUpdate|mastery|eventType|test_pass|test_fail|FULL_LENGTH" apps/api/src
apps/api/src/types/mastery.ts:4: * Sprint 3: TypeScript types for mastery system
apps/api/src/types/mastery.ts:7:import { MasteryEventType } from '../services/mastery-constants';
apps/api/src/types/mastery.ts:67:  eventType: MasteryEventType;
apps/api/src/lib/rag-types.ts:20:  masteryLevel?: number;
apps/api/src/lib/rag-types.ts:103:      masteryLevel: z.number().optional(),
apps/api/src/routes/diagnostic.ts:5: * All endpoints require authentication and use the mastery write choke point.
apps/api/src/routes/diagnostic.ts:15:import { applyMasteryUpdate } from '../services/mastery-write';
apps/api/src/routes/diagnostic.ts:16:import { MasteryEventType } from '../services/mastery-constants';
apps/api/src/routes/diagnostic.ts:228:    // Update mastery via the canonical choke point
apps/api/src/routes/diagnostic.ts:230:    const masteryResult = await applyMasteryUpdate({
apps/api/src/routes/diagnostic.ts:237:      eventType: MasteryEventType.DIAGNOSTIC_SUBMIT,
apps/api/src/routes/diagnostic.ts:249:    if (masteryResult.error) {
apps/api/src/routes/diagnostic.ts:250:      console.warn('[Diagnostic] Mastery update failed:', masteryResult.error);
apps/api/src/routes/rag-v2.ts:63:              { correct?: number; incorrect?: number; total?: number; masteryLevel?: number }
apps/api/src/routes/admin-logs.ts:233:    const { eventType, level, source, message, details, documentId, userId, sessionId, duration } = req.body;
apps/api/src/routes/admin-logs.ts:235:    if (!eventType || !source || !message) {
apps/api/src/routes/admin-logs.ts:238:        details: 'eventType, source, and message are required'
apps/api/src/routes/admin-logs.ts:243:      event_type: eventType,
apps/api/src/routes/calendar.ts:434:    const masterySummary = await getMasterySummary(userId);
apps/api/src/routes/progress.ts:9:// Positive = weakness signal, Negative = recovery/mastery signal
apps/api/src/routes/progress.ts:11:export function getCompetencyDelta(source: 'practice' | 'review', eventType: 'correct' | 'incorrect' | 'skipped'): number {
apps/api/src/routes/progress.ts:12:  if (eventType === 'skipped') {
apps/api/src/routes/progress.ts:16:    return eventType === 'incorrect' ? 1.0 : -1.0;
apps/api/src/routes/progress.ts:18:  return eventType === 'incorrect' ? 1.5 : -0.75;
apps/api/src/routes/progress.ts:58:  eventType: 'correct' | 'incorrect' | 'skipped',
apps/api/src/routes/progress.ts:62:    const delta = getCompetencyDelta(source, eventType);
apps/api/src/routes/progress.ts:73:        event_type: eventType,
apps/api/src/routes/progress.ts:100:        if (eventType === 'incorrect') {
apps/api/src/routes/progress.ts:105:        } else if (eventType === 'skipped') {
apps/api/src/routes/progress.ts:124:            incorrect_count: eventType === 'incorrect' ? 1 : 0,
apps/api/src/routes/progress.ts:125:            review_incorrect_count: eventType === 'incorrect' && source === 'review' ? 1 : 0,
apps/api/src/routes/progress.ts:126:            skipped_count: eventType === 'skipped' ? 1 : 0,
apps/api/src/routes/progress.ts:385:    const { questionId, eventType, sessionId } = req.body;
apps/api/src/routes/progress.ts:387:    if (!questionId || !eventType) {
apps/api/src/routes/progress.ts:388:      return res.status(400).json({ error: 'Missing required fields: questionId, eventType' });
apps/api/src/routes/progress.ts:391:    if (!['correct', 'incorrect', 'skipped'].includes(eventType)) {
apps/api/src/routes/progress.ts:392:      return res.status(400).json({ error: 'eventType must be correct, incorrect, or skipped' });
apps/api/src/routes/progress.ts:422:      eventType as 'correct' | 'incorrect' | 'skipped',
apps/api/src/routes/progress.ts:428:      delta: getCompetencyDelta('review', eventType as 'correct' | 'incorrect' | 'skipped'),
apps/api/src/routes/progress.ts:439: * READ ONLY: Fetches STORED mastery data and computes DERIVED SAT score projection.
apps/api/src/routes/progress.ts:442: * - Recalculate mastery_score (uses stored values from student_skill_mastery)
apps/api/src/routes/progress.ts:444: * - Mutate any mastery state
apps/api/src/routes/progress.ts:446: * SOURCE OF TRUTH: student_skill_mastery table
apps/api/src/routes/progress.ts:455:    // READ ONLY: Fetch stored mastery scores from authoritative table
apps/api/src/routes/progress.ts:456:    const { data: masteryRows, error: masteryError } = await supabaseServer
apps/api/src/routes/progress.ts:457:      .from('student_skill_mastery')
apps/api/src/routes/progress.ts:458:      .select('section, domain, skill, mastery_score, attempts, updated_at')
apps/api/src/routes/progress.ts:461:    if (masteryError) {
apps/api/src/routes/progress.ts:462:      console.error('[Projection] Error fetching mastery:', masteryError.message);
apps/api/src/routes/progress.ts:463:      return res.status(500).json({ error: 'Failed to fetch mastery data' });
apps/api/src/routes/progress.ts:469:    for (const row of masteryRows || []) {
apps/api/src/routes/progress.ts:478:          mastery_score: 0,
apps/api/src/routes/progress.ts:484:      domainMastery[key].mastery_score = Math.max(
apps/api/src/routes/progress.ts:485:        domainMastery[key].mastery_score,
apps/api/src/routes/progress.ts:486:        row.mastery_score || 0
apps/api/src/routes/progress.ts:502:    const masteryArray = Object.values(domainMastery);
apps/api/src/routes/progress.ts:521:    // DERIVED COMPUTATION: Project SAT score from stored mastery data
apps/api/src/routes/progress.ts:522:    // This does NOT recalculate mastery_score, only applies weighting and decay for display
apps/api/src/routes/progress.ts:523:    const projection: ScoreProjection = calculateScore(masteryArray, totalQuestions);
apps/api/src/routes/mastery.ts:5:import { getMasteryStatus } from '../services/mastery-projection';
apps/api/src/routes/mastery.ts:107:  mastery_score: number;
apps/api/src/routes/mastery.ts:116:  mastery_score: number;
apps/api/src/routes/mastery.ts:136: * DERIVED COMPUTATION: Compute mastery status from stored mastery_score
apps/api/src/routes/mastery.ts:138: * This function is now imported from mastery-projection.ts
apps/api/src/routes/mastery.ts:139: * It computes a UI-facing status label from the stored mastery_score.
apps/api/src/routes/mastery.ts:140: * It does NOT recalculate mastery_score itself.
apps/api/src/routes/mastery.ts:144: * - weak: mastery_score < 40%
apps/api/src/routes/mastery.ts:145: * - improving: mastery_score < 70%
apps/api/src/routes/mastery.ts:146: * - proficient: mastery_score >= 70%
apps/api/src/routes/mastery.ts:148:// Function moved to mastery-projection.ts - using import instead
apps/api/src/routes/mastery.ts:157: * GET /mastery/summary - READ ONLY endpoint
apps/api/src/routes/mastery.ts:159: * Returns aggregated mastery summary by section and domain.
apps/api/src/routes/mastery.ts:160: * Does NOT mutate mastery state or recalculate scores.
apps/api/src/routes/mastery.ts:177:    console.error('[Mastery] Error getting mastery summary:', error);
apps/api/src/routes/mastery.ts:178:    res.status(500).json({ error: 'Failed to get mastery summary' });
apps/api/src/routes/mastery.ts:183: * GET /mastery/skills - READ ONLY endpoint
apps/api/src/routes/mastery.ts:185: * Returns full skill tree with mastery status computed from STORED mastery scores.
apps/api/src/routes/mastery.ts:188: * are computed from stored mastery_score, but mastery_score itself is NOT recalculated.
apps/api/src/routes/mastery.ts:190: * Does NOT apply decay, weighting, or mutate mastery state.
apps/api/src/routes/mastery.ts:201:    // READ ONLY: Fetch stored mastery scores
apps/api/src/routes/mastery.ts:202:    const { data: masteryData, error } = await supabase
apps/api/src/routes/mastery.ts:203:      .from("student_skill_mastery")
apps/api/src/routes/mastery.ts:204:      .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
apps/api/src/routes/mastery.ts:209:      return res.status(500).json({ error: "Failed to fetch mastery data" });
apps/api/src/routes/mastery.ts:212:    const masteryMap = new Map<string, SkillMasteryRow>();
apps/api/src/routes/mastery.ts:213:    for (const row of masteryData || []) {
apps/api/src/routes/mastery.ts:215:      masteryMap.set(key, row);
apps/api/src/routes/mastery.ts:231:          const row = masteryMap.get(key);
apps/api/src/routes/mastery.ts:236:          const mastery_score = row?.mastery_score ?? 0;
apps/api/src/routes/mastery.ts:244:            mastery_score: Math.round(mastery_score), // mastery_score now in 0-100 range
apps/api/src/routes/mastery.ts:245:            status: getMasteryStatus(mastery_score, attempts),
apps/api/src/routes/mastery.ts:248:          domainTotalMastery += mastery_score;
apps/api/src/routes/mastery.ts:285: * GET /mastery/weakest - READ ONLY endpoint
apps/api/src/routes/mastery.ts:288: * Does NOT mutate mastery state or recalculate scores.
apps/api/src/routes/mastery.ts:312:      mastery_score: Math.round(row.mastery_score), // mastery_score now in 0-100 range
apps/api/src/routes/mastery.ts:313:      status: getMasteryStatus(row.mastery_score, row.attempts),
apps/api/src/routes/mastery.ts:414:export const masteryRouter = router;
apps/api/src/services/diagnostic-service.ts:19:} from "./mastery-constants";
apps/api/src/services/mastery-projection.ts:5: * - Mastery status labels (derived from mastery_score)
apps/api/src/services/mastery-projection.ts:8: * They NEVER write back to mastery_score columns.
apps/api/src/services/mastery-projection.ts:11: * No client-side decay calculation needed for mastery scores.
apps/api/src/services/mastery-projection.ts:16:} from './mastery-constants';
apps/api/src/services/mastery-projection.ts:17:import type { MasteryStatus } from '../types/mastery';
apps/api/src/services/mastery-projection.ts:20: * Compute mastery status label from mastery_score
apps/api/src/services/mastery-projection.ts:22: * Pure function of mastery_score and attempts count.
apps/api/src/services/mastery-projection.ts:23: * Does NOT recalculate mastery_score itself.
apps/api/src/services/mastery-projection.ts:27: * - weak: mastery_score < 40
apps/api/src/services/mastery-projection.ts:28: * - improving: mastery_score < 70
apps/api/src/services/mastery-projection.ts:29: * - proficient: mastery_score >= 70
apps/api/src/services/mastery-projection.ts:31: * @param masteryScore - The stored mastery_score (0-100)
apps/api/src/services/mastery-projection.ts:36:  masteryScore: number,
apps/api/src/services/mastery-projection.ts:44:  if (masteryScore < MASTERY_STATUS_THRESHOLDS.WEAK) {
apps/api/src/services/mastery-projection.ts:48:  if (masteryScore < MASTERY_STATUS_THRESHOLDS.IMPROVING) {
apps/api/src/services/mastery-write.ts:5: * - student_skill_mastery
apps/api/src/services/mastery-write.ts:6: * - student_cluster_mastery
apps/api/src/services/mastery-write.ts:8: * ALL mastery updates MUST flow through applyMasteryUpdate().
apps/api/src/services/mastery-write.ts:11: * - Add direct .insert/.update/.upsert calls to mastery tables elsewhere
apps/api/src/services/mastery-write.ts:12: * - Create additional RPC calls for mastery writes
apps/api/src/services/mastery-write.ts:16: * - Consistent mastery calculation logic
apps/api/src/services/mastery-write.ts:19: * - Single source of truth for mastery algorithm
apps/api/src/services/mastery-write.ts:21: * ENFORCEMENT: tests/mastery.writepaths.guard.test.ts validates this invariant.
apps/api/src/services/mastery-write.ts:29:} from "./mastery-constants";
apps/api/src/services/mastery-write.ts:48:  eventType: MasteryEventType;
apps/api/src/services/mastery-write.ts:60: * applyMasteryUpdate - CANONICAL CHOKE POINT for all mastery writes
apps/api/src/services/mastery-write.ts:65: * 3. Updates student_skill_mastery via RPC (if metadata available and event is scored)
apps/api/src/services/mastery-write.ts:66: * 4. Updates student_cluster_mastery via RPC (if cluster ID available and event is scored)
apps/api/src/services/mastery-write.ts:68: * CRITICAL: This is the ONLY function that should write to mastery tables.
apps/api/src/services/mastery-write.ts:69: * All mastery updates in the application MUST call this function.
apps/api/src/services/mastery-write.ts:72: * - TUTOR_VIEW does not change mastery (no-op for mastery updates)
apps/api/src/services/mastery-write.ts:73: * - All other event types trigger mastery updates with their respective weights
apps/api/src/services/mastery-write.ts:78:export async function applyMasteryUpdate(input: AttemptInput): Promise<AttemptResult> {
apps/api/src/services/mastery-write.ts:82:  if (!(input.eventType in EVENT_WEIGHTS)) {
apps/api/src/services/mastery-write.ts:86:      error: `Invalid event type: ${input.eventType}. Must be one of: ${Object.keys(EVENT_WEIGHTS).join(', ')}`,
apps/api/src/services/mastery-write.ts:95:  const eventWeight = EVENT_WEIGHTS[input.eventType];
apps/api/src/services/mastery-write.ts:98:  // TUTOR_VIEW is a no-op for mastery - we still log the attempt but don't update mastery
apps/api/src/services/mastery-write.ts:99:  const shouldUpdateMastery = input.eventType !== MasteryEventType.TUTOR_VIEW;
apps/api/src/services/mastery-write.ts:101:  // Step 1: Log raw attempt (not a mastery table, but part of the write transaction)
apps/api/src/services/mastery-write.ts:130:  // Step 2: Update student_skill_mastery (CANONICAL WRITE #1)
apps/api/src/services/mastery-write.ts:131:  // This RPC performs INSERT...ON CONFLICT DO UPDATE on student_skill_mastery
apps/api/src/services/mastery-write.ts:135:      const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
apps/api/src/services/mastery-write.ts:156:  // Step 3: Update student_cluster_mastery (CANONICAL WRITE #2)
apps/api/src/services/mastery-write.ts:157:  // This RPC performs INSERT...ON CONFLICT DO UPDATE on student_cluster_mastery
apps/api/src/services/mastery-write.ts:161:      const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
apps/api/src/services/mastery-write.ts:190: * @deprecated Use applyMasteryUpdate() instead for clarity.
apps/api/src/services/mastery-write.ts:193:export const logAttemptAndUpdateMastery = applyMasteryUpdate;
apps/api/src/services/mastery-constants.ts:4: * Sprint 3: All mastery calculation constants are defined here.
apps/api/src/services/mastery-constants.ts:7: * This is the single source of truth for mastery algorithm parameters.
apps/api/src/services/mastery-constants.ts:17:  FULL_LENGTH_SUBMIT = 'FULL_LENGTH_SUBMIT',
apps/api/src/services/mastery-constants.ts:27: * ALPHA - Global learning rate for mastery updates
apps/api/src/services/mastery-constants.ts:28: * Controls how much each new attempt influences the stored mastery score.
apps/api/src/services/mastery-constants.ts:37: * base_delta - Base magnitude for mastery change per attempt
apps/api/src/services/mastery-constants.ts:45: * M_init - Initial mastery score for cold start (no attempts yet)
apps/api/src/services/mastery-constants.ts:53: * M_min, M_max - Clamp bounds for mastery_score
apps/api/src/services/mastery-constants.ts:54: * All mastery scores are clamped to [0, 100]
apps/api/src/services/mastery-constants.ts:77:  [MasteryEventType.FULL_LENGTH_SUBMIT]: 1.50,
apps/api/src/services/mastery-constants.ts:78:  [MasteryEventType.TUTOR_VIEW]: 0.00, // No mastery change
apps/api/src/services/mastery-constants.ts:88: * After 6 weeks of inactivity, mastery estimate decays to 50%
apps/api/src/services/mastery-constants.ts:92: * Never write decayed mastery back to mastery_score column.
apps/api/src/services/mastery-constants.ts:119:// F. Mastery Status Thresholds (UI labels, derived from mastery_score)
apps/api/src/services/mastery-constants.ts:123: * Thresholds for mastery status labels
apps/api/src/services/mastery-constants.ts:124: * These are pure functions of mastery_score, not stored values
apps/api/src/services/studentMastery.ts:5: * MASTERY WRITE FUNCTIONS MOVED TO mastery-write.ts
apps/api/src/services/studentMastery.ts:7: * Sprint 3 PR-1: All mastery write operations have been moved to the canonical
apps/api/src/services/studentMastery.ts:8: * choke point module: apps/api/src/services/mastery-write.ts
apps/api/src/services/studentMastery.ts:15: * DO NOT add mastery write logic here. Use mastery-write.ts instead.
apps/api/src/services/studentMastery.ts:23:} from "./mastery-write";
apps/api/src/services/studentMastery.ts:26:  applyMasteryUpdate,
apps/api/src/services/studentMastery.ts:28:} from "./mastery-write";
apps/api/src/services/studentMastery.ts:45: * It does NOT write to mastery tables or mutate any mastery state.
apps/api/src/services/studentMastery.ts:108:  mastery_score: number;
apps/api/src/services/studentMastery.ts:116:  mastery_score: number;
apps/api/src/services/studentMastery.ts:120: * getWeakestSkills - READ-ONLY query for student_skill_mastery
apps/api/src/services/studentMastery.ts:124: * - Recalculate mastery scores
apps/api/src/services/studentMastery.ts:128: * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
apps/api/src/services/studentMastery.ts:136:    .from("student_skill_mastery")
apps/api/src/services/studentMastery.ts:137:    .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
apps/api/src/services/studentMastery.ts:158: * getWeakestClusters - READ-ONLY query for student_cluster_mastery
apps/api/src/services/studentMastery.ts:162: * - Recalculate mastery scores
apps/api/src/services/studentMastery.ts:166: * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
apps/api/src/services/studentMastery.ts:174:    .from("student_cluster_mastery")
apps/api/src/services/studentMastery.ts:175:    .select("structure_cluster_id, attempts, correct, accuracy, mastery_score")
apps/api/src/services/studentMastery.ts:203: * getMasterySummary - READ-ONLY query for student_skill_mastery
apps/api/src/services/studentMastery.ts:207: * - Recalculate mastery scores
apps/api/src/services/studentMastery.ts:211: * Aggregates stored mastery data by section and domain.
apps/api/src/services/studentMastery.ts:212: * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
apps/api/src/services/studentMastery.ts:221:    .from("student_skill_mastery")
apps/api/src/services/studentMastery.ts:232:    console.error("[Mastery] Failed to get mastery summary:", error?.message);
apps/api/src/services/__tests__/adaptiveSelector.test.ts:112:      { structure_cluster_id: 'cluster-1', accuracy: 0.3, attempts: 10, correct: 3, mastery_score: 0.3 },
apps/api/src/services/__tests__/adaptiveSelector.test.ts:128:      { section: 'math', domain: 'Algebra', skill: 'Linear equations', accuracy: 0.4, attempts: 10, correct: 4, mastery_score: 0.4 },
apps/api/src/services/__tests__/adaptiveSelector.test.ts:194:      { structure_cluster_id: 'cluster-1', accuracy: 0.2, attempts: 10, correct: 2, mastery_score: 0.2 },
apps/api/src/services/__tests__/adaptiveSelector.test.ts:195:      { structure_cluster_id: 'cluster-2', accuracy: 0.4, attempts: 10, correct: 4, mastery_score: 0.4 },
apps/api/src/services/__tests__/adaptiveSelector.test.ts:196:      { structure_cluster_id: 'cluster-3', accuracy: 0.5, attempts: 10, correct: 5, mastery_score: 0.5 },
```

## G) Existing tests — command outputs

```bash
$ rg -n "tests|test_sessions|test_forms|/api/tests|sat_score" tests apps/api/src --glob "*.test.*"
tests/integration/protected-routes.integration.test.ts:4: * These tests validate protected route behavior with real authentication.
tests/integration/protected-routes.integration.test.ts:7: * These tests are EXCLUDED from required CI and only run manually or in
tests/integration/protected-routes.integration.test.ts:43:  return `Supabase integration tests require: ${missing.join(', ')}. Set these environment variables to run integration tests.`;
tests/integration/protected-routes.integration.test.ts:46:// Skip all integration tests if Supabase env vars are not available
tests/integration/protected-routes.integration.test.ts:50:  console.warn('⚠️  Skipping integration tests:', getSkipMessage());
tests/integration/protected-routes.integration.test.ts:51:  console.warn('   These tests require real Supabase credentials.');
tests/integration/auth.integration.test.ts:4: * These tests validate real authentication flows with Supabase.
tests/integration/auth.integration.test.ts:7: * These tests are EXCLUDED from required CI and only run manually or in
tests/integration/auth.integration.test.ts:43:  return `Supabase integration tests require: ${missing.join(', ')}. Set these environment variables to run integration tests.`;
tests/integration/auth.integration.test.ts:46:// Skip all integration tests if Supabase env vars are not available
tests/integration/auth.integration.test.ts:50:  console.warn('⚠️  Skipping integration tests:', getSkipMessage());
tests/integration/auth.integration.test.ts:51:  console.warn('   These tests require real Supabase credentials.');
tests/ci/security.ci.test.ts:4: * These tests validate CSRF protection behavior at the HTTP boundary
tests/ci/routes.ci.test.ts:4: * These tests validate that public and protected routes behave correctly
tests/ci/auth.ci.test.ts:4: * These tests validate authentication behavior at the HTTP boundary
tests/ci/auth.ci.test.ts:19:// These tests run in CI without secrets
tests/mastery.writepaths.guard.test.ts:55:  "__tests__",
tests/mastery.true-halflife.edgecases.test.ts:4: * Sprint 3 PR-3: Deterministic tests for True Half-Life mastery formula edge cases.
```

## File:line evidence snippets

### Route mounting and role gates

```ts
# server/index.ts (selected)

// Notifications Routes
app.use("/api/notifications", notificationRoutes);

// Weakness & Mastery Routes (student weakness tracking)
app.use("/api/me/weakness", requireSupabaseAuth, requireStudentOrAdmin, weaknessRouter);
app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter);
app.use("/api/me/mastery/diagnostic", requireSupabaseAuth, requireStudentOrAdmin, diagnosticRouter);
app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter);

// Score Projection endpoint (College Board weighted algorithm)
app.get("/api/progress/projection", requireSupabaseAuth, requireStudentOrAdmin, getScoreProjection);

// Recency KPIs endpoint (last 200 attempts stats)
app.get("/api/progress/kpis", requireSupabaseAuth, requireStudentOrAdmin, getRecencyKpis);

```

### Diagnostic route anti-leak-ish delivery (no answer fields in /next select)

```ts
# apps/api/src/routes/diagnostic.ts (selected)
    
    if (result.isComplete) {
      return res.json({
        isComplete: true,
        questionIndex: result.questionIndex,
        totalQuestions: result.totalQuestions,
      });
    }
    
    // Fetch full question data (without answer/explanation)
    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select(`
        id,
        canonical_id,
        stem,
        options,
        section,
        type,
        domain,
        skill,
        difficulty_bucket
      `)
      .eq('canonical_id', result.questionId)
      .single();
    
    if (questionError || !question) {
      return res.status(500).json({ error: 'Failed to load question' });
    }
```

### Diagnostic answer currently returns explanation on wrong answers

```ts
# apps/api/src/routes/diagnostic.ts (selected)
      },
    });
    
    if (masteryResult.error) {
      console.warn('[Diagnostic] Mastery update failed:', masteryResult.error);
    }
    
    return res.json({
      isCorrect,
      isComplete: recordResult.isComplete,
      nextQuestionId: recordResult.nextQuestionId,
      explanation: isCorrect ? null : (question.explanation || null), // Show explanation on wrong answers
    });
  } catch (err: any) {
    console.error('[Diagnostic] Error submitting answer:', err);
    return res.status(500).json({ error: 'Failed to submit answer' });
  }
```

### Canonical mastery write choke point

```ts
# apps/api/src/services/mastery-write.ts (selected)
  error?: string;
}

/**
 * applyMasteryUpdate - CANONICAL CHOKE POINT for all mastery writes
 * 
 * This function:
 * 1. Validates event type (must be in MasteryEventType enum)
 * 2. Logs the attempt to student_question_attempts
 * 3. Updates student_skill_mastery via RPC (if metadata available and event is scored)
 * 4. Updates student_cluster_mastery via RPC (if cluster ID available and event is scored)
 * 
 * CRITICAL: This is the ONLY function that should write to mastery tables.
 * All mastery updates in the application MUST call this function.
 * 
 * Mastery v1.0: Uses event-weighted delta formula with EMA-style updates.
 * - TUTOR_VIEW does not change mastery (no-op for mastery updates)
 * - All other event types trigger mastery updates with their respective weights
 * 
 * @param input - Attempt data including user, question, correctness, event type, and metadata
 * @returns AttemptResult with attemptId and status
 */
export async function applyMasteryUpdate(input: AttemptInput): Promise<AttemptResult> {
  const supabase = getSupabaseAdmin();
  
  // Validate event type (closed set enforcement)
  if (!(input.eventType in EVENT_WEIGHTS)) {
    return {
      attemptId: '',
      rollupUpdated: false,
      error: `Invalid event type: ${input.eventType}. Must be one of: ${Object.keys(EVENT_WEIGHTS).join(', ')}`,
    };
  }
  
  const attemptId = crypto.randomUUID();
```

### FULL_LENGTH_SUBMIT exists in constants but no discovered full-length route usage

```ts
# apps/api/src/services/mastery-constants.ts (selected)
// ============================================================================

export enum MasteryEventType {
  PRACTICE_SUBMIT = 'PRACTICE_SUBMIT',
  DIAGNOSTIC_SUBMIT = 'DIAGNOSTIC_SUBMIT',
  FULL_LENGTH_SUBMIT = 'FULL_LENGTH_SUBMIT',
  TUTOR_VIEW = 'TUTOR_VIEW',
  TUTOR_RETRY_SUBMIT = 'TUTOR_RETRY_SUBMIT',
}

// ============================================================================
// B. Core Mastery Formula Constants
// ============================================================================
```

### Diagnostic session tables and RLS in migrations

```sql
# supabase/migrations/20260210_mastery_v1.sql (selected)
-- Step 2: Create diagnostic_sessions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.diagnostic_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blueprint_version VARCHAR(32) NOT NULL DEFAULT 'diag_v1',
  question_ids TEXT[] NOT NULL, -- Ordered array of canonical IDs
  current_index INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_student_id 
  ON public.diagnostic_sessions(student_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_completed 
  ON public.diagnostic_sessions(student_id, completed_at);

-- ============================================================================
-- Step 3: Create diagnostic_responses table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.diagnostic_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.diagnostic_sessions(id) ON DELETE CASCADE,
  question_canonical_id VARCHAR(16) NOT NULL,
  question_index INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL,
  selected_choice VARCHAR(1),
  time_spent_ms INTEGER,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(session_id, question_index)
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_responses_session_id 
  ON public.diagnostic_responses(session_id);

-- ============================================================================
-- Step 4: Add RLS policies for diagnostic tables
-- ============================================================================

ALTER TABLE public.diagnostic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_responses ENABLE ROW LEVEL SECURITY;

-- Students can only access their own diagnostic sessions
CREATE POLICY "Users can view own diagnostic sessions" 
  ON public.diagnostic_sessions
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Service role can manage diagnostic sessions" 
  ON public.diagnostic_sessions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Students can only access responses for their own sessions
CREATE POLICY "Users can view own diagnostic responses" 
  ON public.diagnostic_responses
  FOR SELECT USING (
    session_id IN (
      SELECT id FROM public.diagnostic_sessions WHERE student_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage diagnostic responses" 
  ON public.diagnostic_responses
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Service role bypass
CREATE POLICY "Service role full access to diagnostic sessions" 
  ON public.diagnostic_sessions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to diagnostic responses" 
  ON public.diagnostic_responses
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
```
