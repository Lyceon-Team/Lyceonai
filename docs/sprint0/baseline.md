# Sprint 0 Baseline (main)

## CI workflows
- .github/workflows/ci.yml ("CI")

## Commands run
- pnpm install
- pnpm run check
- pnpm test
- pnpm run build

## Results

### pnpm run check (tsc) failures
```
apps/api/src/ingestion_v4/services/v4Clustering.ts(649,9): error TS2322: Type 'StyleCluster | null' is not assignable to type 'StyleCluster | undefined'.
  Type 'null' is not assignable to type 'StyleCluster | undefined'.
apps/api/src/ingestion_v4/services/v4Clustering.ts(821,11): error TS2719: Type '{ section: "math" | "rw"; version: "v4_style_cluster_v2"; questionType: string | null; difficultyLevel: 2 | 1 | 3 | null; pageNumber: number; skill: string | null; domain: string | null; ... 5 more ...; clusterRecommendation: { ...; }; }' is not assignable to type '{ section: "math" | "rw"; version: "v4_style_cluster_v2"; questionType: string | null; difficultyLevel: 2 | 1 | 3 | null; pageNumber: number; skill: string | null; domain: string | null; ... 5 more ...; clusterRecommendation: { ...; }; }'. Two different types with this name exist, but they are unrelated.
  The types of 'evidence.notes' are incompatible between these types.
    Type 'string[] | undefined' is not assignable to type 'string[]'.
      Type 'undefined' is not assignable to type 'string[]'.
apps/api/src/ingestion_v4/services/v4Clustering.ts(834,48): error TS2345: Argument of type '{ section: "math" | "rw"; version: "v4_style_cluster_v2"; questionType: string | null; difficultyLevel: 2 | 1 | 3 | null; pageNumber: number; skill: string | null; domain: string | null; ... 5 more ...; clusterRecommendation: { ...; }; }' is not assignable to parameter of type '{ section: "math" | "rw"; version: "v4_style_cluster_v2"; questionType: string | null; difficultyLevel: 2 | 1 | 3 | null; pageNumber: number; skill: string | null; domain: string | null; ... 5 more ...; clusterRecommendation: { ...; }; }'.
  The types of 'evidence.notes' are incompatible between these types.
    Type 'string[] | undefined' is not assignable to type 'string[]'.
      Type 'undefined' is not assignable to type 'string[]'.
apps/api/src/ingestion_v4/services/v4QueueWorker.ts(92,61): error TS2345: Argument of type '{ count: number; sleepMs: number; stopOnQaFail: boolean; maxQaFails: number; }' is not assignable to parameter of type '{ section: "math" | "rw"; count: number; sleepMs: number; stopOnQaFail: boolean; maxQaFails: number; }'.
  Property 'section' is missing in type '{ count: number; sleepMs: number; stopOnQaFail: boolean; maxQaFails: number; }' but required in type '{ section: "math" | "rw"; count: number; sleepMs: number; stopOnQaFail: boolean; maxQaFails: number; }'.
apps/api/src/middleware/auth.ts(23,18): error TS2430: Interface 'ApiAuthenticatedRequest' incorrectly extends interface 'Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>'.
  Types of property 'user' are incompatible.
    Type '{ id: string; email?: string | null | undefined; display_name?: string | null | undefined; role?: "student" | "admin" | "guardian" | undefined; isAdmin?: boolean | undefined; isGuardian?: boolean | undefined; ... 4 more ...; name?: string | undefined; } | undefined' is not assignable to type 'SupabaseUser | undefined'.
      Type '{ id: string; email?: string | null | undefined; display_name?: string | null | undefined; role?: "student" | "admin" | "guardian" | undefined; isAdmin?: boolean | undefined; isGuardian?: boolean | undefined; ... 4 more ...; name?: string | undefined; }' is not assignable to type 'SupabaseUser'.
        Types of property 'email' are incompatible.
          Type 'string | null | undefined' is not assignable to type 'string'.
            Type 'undefined' is not assignable to type 'string'.
apps/api/src/routes/calendar.ts(19,11): error TS2430: Interface 'AuthenticatedRequest' incorrectly extends interface 'Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>'.
  Types of property 'user' are incompatible.
    Type 'SupabaseUser | undefined' is not assignable to type 'import("/workspace/Lyceonai/server/middleware/supabase-auth").SupabaseUser | undefined'.
      Type 'SupabaseUser' is not assignable to type 'import("/workspace/Lyceonai/server/middleware/supabase-auth").SupabaseUser'.
        Types of property 'isGuardian' are incompatible.
          Type 'boolean | undefined' is not assignable to type 'boolean'.
            Type 'undefined' is not assignable to type 'boolean'.
apps/api/src/routes/ingestion-v4.ts(1510,7): error TS2322: Type 'CanonicalSection | null | undefined' is not assignable to type 'CanonicalSection | undefined'.
  Type 'null' is not assignable to type 'CanonicalSection | undefined'.
apps/api/src/routes/tutor-v2.ts(234,39): error TS2304: Cannot find name 'supabaseServer'.
client/src/pages/flow-cards.tsx(327,21): error TS2322: Type '{ question: StudentQuestion; questionIndex: number; selectedAnswer: string | null; freeResponseAnswer: string; onAnswerSelect: (answerKey: string) => void; onFreeResponseChange: (answer: string) => void; showResult: false; validationResult: null; hideActions: boolean; }' is not assignable to type 'IntrinsicAttributes & QuestionRendererProps'.
  Property 'questionIndex' does not exist on type 'IntrinsicAttributes & QuestionRendererProps'.
client/src/pages/structured-practice.tsx(101,5): error TS2304: Cannot find name 'setIsValidating'.
client/src/pages/structured-practice.tsx(103,13): error TS2552: Cannot find name 'apiRequest'. Did you mean 'Request'?
client/src/pages/structured-practice.tsx(115,7): error TS2304: Cannot find name 'setScore'.
client/src/pages/structured-practice.tsx(115,16): error TS7006: Parameter 'prev' implicitly has an 'any' type.
client/src/pages/structured-practice.tsx(125,7): error TS2304: Cannot find name 'setIsValidating'.
client/src/pages/structured-practice.tsx(126,13): error TS2304: Cannot find name 'handleNext'.
client/src/pages/structured-practice.tsx(298,17): error TS2322: Type '{ question: StudentQuestion; questionIndex: number; selectedAnswer: string | null; freeResponseAnswer: string; onAnswerSelect: (answer: any) => void; onFreeResponseChange: (answer: any) => void; showResult: boolean; validationResult: ValidationResult | null; hideActions: boolean; }' is not assignable to type 'IntrinsicAttributes & QuestionRendererProps'.
  Property 'questionIndex' does not exist on type 'IntrinsicAttributes & QuestionRendererProps'.
client/src/pages/structured-practice.tsx(301,34): error TS7006: Parameter 'answer' implicitly has an 'any' type.
client/src/pages/structured-practice.tsx(302,40): error TS7006: Parameter 'answer' implicitly has an 'any' type.
server/index.ts(600,11): error TS2304: Cannot find name 'runMigrations'.
server/index.ts(603,30): error TS2552: Cannot find name 'getStripeSync'. Did you mean 'stripeSync'?
server/index.ts(728,9): error TS2304: Cannot find name 'isWorkerEnabled'.
server/index.ts(729,7): error TS2304: Cannot find name 'startWorker'.
server/index.ts(737,26): error TS2304: Cannot find name 'getWorkerStatus'.
server/index.ts(742,5): error TS2304: Cannot find name 'stopWorker'.
server/lib/webhookHandlers.ts(308,26): error TS2304: Cannot find name 'getStripeSync'.
server/routes/billing-routes.ts(120,28): error TS2367: This comparison appears to be unintentional because the types '"student" | "admin" | "guardian"' and '"parent"' have no overlap.
```

### pnpm test (vitest run) failures
```
FAIL  tests/auth.integration.test.ts [ tests/auth.integration.test.ts ]
FAIL  tests/entitlements.regression.test.ts [ tests/entitlements.regression.test.ts ]
FAIL  tests/practice.validate.regression.test.ts [ tests/practice.validate.regression.test.ts ]
FAIL  tests/tutor.v2.regression.test.ts [ tests/tutor.v2.regression.test.ts ]
Error: supabaseUrl is required.

FAIL  tests/regressions.test.ts [ tests/regressions.test.ts ]
Error: Transform failed with 1 error:
/workspace/Lyceonai/tests/regressions.test.ts:88:11: ERROR: Expected "}" but found ")"

FAIL  tests/idor.regression.test.ts > IDOR Regression Invariants > tutor_v2_userid_ignored_from_body
AssertionError: expected "vi.fn()" to be called with arguments: [ ObjectContaining{…} ]

FAIL  apps/api/src/ingestion_v4/__tests__/schemas.test.ts > ingestion_v4 schemas > CreateJobRequestSchema > rejects job request with empty styleRefs
AssertionError: expected [Function] to throw an error

FAIL  apps/api/src/ingestion_v4/__tests__/publisher.test.ts > v4Publisher > buildQuestionRowFromV4 > maps Reading section to RW section_code
AssertionError: expected undefined to be 'RW' // Object.is equality

FAIL  apps/api/src/ingestion_v4/__tests__/publisher.test.ts > v4Publisher > buildQuestionRowFromV4 > maps Writing section to RW section_code
AssertionError: expected undefined to be 'RW' // Object.is equality

FAIL  apps/api/src/services/__tests__/adaptiveSelector.test.ts > adaptiveSelector > should return a question for math section
TypeError: supabase.from(...).select(...).not is not a function

FAIL  client/src/__tests__/useShortcuts.guard.test.tsx > does NOT fire when typing in an input/textarea/contenteditable

FAIL  client/src/__tests__/toaster.guard.test.tsx > mounts exactly one toaster even if provider is rendered twice
```

### pnpm run build
Succeeded locally.
