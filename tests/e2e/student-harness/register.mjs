// Registers the exam harness's module hooks (../exam-harness/hooks.mjs, see its header) for the
// student screenshot harness, keeping the PRODUCTION EntitlementService: free and paid come from
// real `entitlements` rows. Used only as `tsx --import ./tests/e2e/student-harness/register.mjs`.
import { register } from "node:module";
register("../exam-harness/hooks.mjs", import.meta.url, {
  data: { keep: ["entitlement-service"] },
});
