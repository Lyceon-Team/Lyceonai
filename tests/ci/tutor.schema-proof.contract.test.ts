import { describe, expect, it } from "vitest";
import { assertTutorSchemaProof, collectTutorSchemaProof } from "../../scripts/tutor-schema-proof";

const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
const hasLiveDbUrl = Boolean(dbUrl && !dbUrl.includes("placeholder"));

const maybeDescribe = hasLiveDbUrl ? describe : describe.skip;

maybeDescribe("Tutor Live Schema Proof Contract", () => {
  it(
    "matches locked tutor schema/runtime expectations",
    async () => {
      const proof = await collectTutorSchemaProof();
      const failures = assertTutorSchemaProof(proof);
      expect(failures).toEqual([]);
    },
    90_000,
  );
});
