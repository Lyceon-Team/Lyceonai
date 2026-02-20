import { createAuthCookie, TEST_USER_IDS } from "../utils/auth-helpers";
import type { Test } from "supertest";

export function withTestUserCookie(request: Test, userId: string = TEST_USER_IDS.student) {
  return request.set("Cookie", [createAuthCookie(userId)]);
}
