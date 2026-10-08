/**
 * The marketing reconcile's rule set, pure.
 *
 * @spec [contracts/notifications.contract.md §14 (amended 2026-10-07); owner Step 0 decisions
 *       2 (delete the contact on opt-out) and 6 (the synced segments are the only audience),
 *       2026-10-07] | @implemented [2026-10-07]
 *
 * plain English: `planMarketingReconcile` decides everything the daily run does. These cases pin
 * each rule without a network or a database; the PG suite proves the same rules end to end
 * against the real SQL. Fixtures are built so the values that must differ CAN differ (two
 * segments, a contact id that is not the profile id, an address in a different case).
 */
import { describe, expect, it } from "vitest";
import {
  planMarketingReconcile,
  type AudienceRow,
  type KnownContactRow,
} from "../../server/lib/marketing-email-sync";
import type { ResendContact } from "../../server/lib/notifications/transport";

const TEEN = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";

const audience: AudienceRow[] = [
  { profile_id: TEEN, email: "teen@x.test", segment: "students" },
  { profile_id: PARENT, email: "parent@x.test", segment: "guardians" },
];

function contact(
  id: string,
  email: string,
  unsubscribed = false,
): ResendContact {
  return { id, email, unsubscribed };
}

function members(
  students: string[],
  guardians: string[],
): { students: ReadonlySet<string>; guardians: ReadonlySet<string> } {
  return { students: new Set(students), guardians: new Set(guardians) };
}

describe("planMarketingReconcile", () => {
  it("creates one contact per eligible profile, in its audience's segment", () => {
    const plan = planMarketingReconcile({
      audience,
      known: [],
      contacts: [],
      members: members([], []),
    });
    expect(plan.create).toEqual([
      { profileId: TEEN, email: "teen@x.test", segment: "students" },
      { profileId: PARENT, email: "parent@x.test", segment: "guardians" },
    ]);
    expect(plan.delete).toEqual([]);
    expect(plan.optOut).toEqual([]);
  });

  it("a correct state plans nothing (idempotent)", () => {
    const known: KnownContactRow[] = [
      { profile_id: TEEN, resend_contact_id: "c_teen", segment: "students" },
      {
        profile_id: PARENT,
        resend_contact_id: "c_parent",
        segment: "guardians",
      },
    ];
    const plan = planMarketingReconcile({
      audience,
      known,
      contacts: [
        contact("c_teen", "TEEN@x.test"),
        contact("c_parent", "parent@x.test"),
      ],
      members: members(["c_teen"], ["c_parent"]),
    });
    expect(plan).toEqual({
      optOut: [],
      delete: [],
      create: [],
      record: [],
      forget: [],
    });
  });

  it("deletes every contact no eligible profile backs — the manual-import guard", () => {
    const plan = planMarketingReconcile({
      audience,
      known: [],
      contacts: [contact("c_manual", "someone-else@x.test")],
      members: members([], []),
    });
    expect(plan.delete).toEqual([{ contactId: "c_manual", profileId: null }]);
  });

  it("an opted-out profile's contact is deleted and its record forgotten", () => {
    const plan = planMarketingReconcile({
      audience: [audience[1]!],
      known: [
        { profile_id: TEEN, resend_contact_id: "c_teen", segment: "students" },
      ],
      contacts: [contact("c_teen", "teen@x.test")],
      members: members(["c_teen"], []),
    });
    expect(plan.delete).toEqual([{ contactId: "c_teen", profileId: TEEN }]);
    expect(plan.forget).toEqual(["c_teen"]);
  });

  it("an unsubscribed contact brings the opt-out back FIRST and is then deleted; nothing is re-created", () => {
    const plan = planMarketingReconcile({
      audience,
      known: [
        { profile_id: TEEN, resend_contact_id: "c_teen", segment: "students" },
      ],
      contacts: [contact("c_teen", "teen@x.test", true)],
      members: members(["c_teen"], []),
    });
    expect(plan.optOut).toEqual([
      { contactId: "c_teen", email: "teen@x.test" },
    ]);
    expect(plan.delete).toContainEqual({
      contactId: "c_teen",
      profileId: TEEN,
    });
    expect(plan.create.map((c) => c.profileId)).toEqual([PARENT]);
  });

  it("an unsubscribed contact with no eligible profile still reports its unsubscribe before deletion", () => {
    const plan = planMarketingReconcile({
      audience: [],
      known: [],
      contacts: [contact("c_manual", "launch@x.test", true)],
      members: members([], []),
    });
    expect(plan.optOut).toEqual([
      { contactId: "c_manual", email: "launch@x.test" },
    ]);
    expect(plan.delete).toEqual([{ contactId: "c_manual", profileId: null }]);
  });

  it("a contact in the wrong segment (role change) is replaced, never left in both", () => {
    const plan = planMarketingReconcile({
      audience: [audience[1]!],
      known: [
        {
          profile_id: PARENT,
          resend_contact_id: "c_parent",
          segment: "students",
        },
      ],
      contacts: [contact("c_parent", "parent@x.test")],
      members: members(["c_parent"], []),
    });
    expect(plan.delete).toEqual([{ contactId: "c_parent", profileId: PARENT }]);
    expect(plan.create).toEqual([
      { profileId: PARENT, email: "parent@x.test", segment: "guardians" },
    ]);
  });

  it("a contact in BOTH synced segments is replaced", () => {
    const plan = planMarketingReconcile({
      audience: [audience[0]!],
      known: [],
      contacts: [contact("c_teen", "teen@x.test")],
      members: members(["c_teen"], ["c_teen"]),
    });
    expect(plan.delete).toEqual([{ contactId: "c_teen", profileId: TEEN }]);
    expect(plan.create.map((c) => c.profileId)).toEqual([TEEN]);
  });

  it("a correct contact Lyceon has no record of is recorded, not re-created", () => {
    const plan = planMarketingReconcile({
      audience: [audience[0]!],
      known: [],
      contacts: [contact("c_teen", "teen@x.test")],
      members: members(["c_teen"], []),
    });
    expect(plan.create).toEqual([]);
    expect(plan.record).toEqual([
      { profileId: TEEN, contactId: "c_teen", segment: "students" },
    ]);
  });
});
