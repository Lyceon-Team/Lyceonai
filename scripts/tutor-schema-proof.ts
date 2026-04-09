import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

const TUTOR_TABLES = [
  "tutor_conversations",
  "tutor_messages",
  "tutor_instruction_assignments",
  "tutor_question_links",
  "tutor_memory_summaries",
  "tutor_instruction_exposures",
] as const;

type TutorTable = (typeof TUTOR_TABLES)[number];

type ColumnMeta = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  ordinal_position: number;
};

type IndexMeta = {
  tablename: string;
  indexname: string;
  indexdef: string;
};

type CheckConstraintMeta = {
  table_name: string;
  constraint_name: string;
  constraint_def: string;
};

type ForeignKeyConstraintMeta = {
  table_name: string;
  constraint_name: string;
  constraint_def: string;
};

type RlsMeta = {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
};

type PolicyMeta = {
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

type SchemaProof = {
  generated_at: string;
  table_columns: Record<TutorTable, ColumnMeta[]>;
  indexes: Record<TutorTable, IndexMeta[]>;
  checks: Record<TutorTable, CheckConstraintMeta[]>;
  fks: Record<TutorTable, ForeignKeyConstraintMeta[]>;
  rls: Record<TutorTable, RlsMeta>;
  policies: Record<TutorTable, PolicyMeta[]>;
};

const REQUIRED_COLUMNS: Record<TutorTable, string[]> = {
  tutor_conversations: [
    "id",
    "student_id",
    "entry_mode",
    "source_surface",
    "source_session_id",
    "source_session_item_id",
    "source_question_row_id",
    "source_question_canonical_id",
    "policy_family",
    "policy_variant",
    "policy_version",
    "prompt_version",
    "assignment_mode",
    "assignment_key",
    "initialization_snapshot",
    "status",
    "created_at",
    "updated_at",
  ],
  tutor_messages: [
    "id",
    "conversation_id",
    "student_id",
    "role",
    "content_kind",
    "message",
    "content_json",
    "explanation_level",
    "source_session_id",
    "source_session_item_id",
    "source_question_row_id",
    "source_question_canonical_id",
    "client_turn_id",
    "created_at",
  ],
  tutor_instruction_assignments: [
    "id",
    "conversation_id",
    "student_id",
    "related_message_id",
    "source_session_id",
    "source_session_item_id",
    "source_question_row_id",
    "source_question_canonical_id",
    "policy_family",
    "policy_variant",
    "policy_version",
    "prompt_version",
    "assignment_mode",
    "assignment_key",
    "reason_snapshot",
    "created_at",
  ],
  tutor_question_links: [
    "id",
    "conversation_id",
    "student_id",
    "source_question_row_id",
    "source_question_canonical_id",
    "related_question_row_id",
    "related_question_canonical_id",
    "relationship_type",
    "difficulty_delta",
    "reason_code",
    "link_snapshot",
    "created_at",
  ],
  tutor_memory_summaries: [
    "id",
    "student_id",
    "summary_type",
    "summary_version",
    "content_json",
    "source_window_start",
    "source_window_end",
    "created_at",
  ],
  tutor_instruction_exposures: [
    "id",
    "assignment_id",
    "conversation_id",
    "student_id",
    "exposure_type",
    "content_variant_key",
    "content_version",
    "rendered_difficulty",
    "hint_depth",
    "tone_style",
    "sequence_ordinal",
    "shown_at",
    "consumed_ms",
  ],
};

const REQUIRED_ENUMS: Array<{ table: TutorTable; column: string; values: string[] }> = [
  { table: "tutor_conversations", column: "entry_mode", values: ["scoped_question", "scoped_session", "general"] },
  { table: "tutor_conversations", column: "source_surface", values: ["practice", "review", "test_review", "dashboard"] },
  { table: "tutor_conversations", column: "status", values: ["active", "closed", "abandoned"] },
  { table: "tutor_conversations", column: "assignment_mode", values: ["deterministic", "explore", "manual_override"] },
  { table: "tutor_messages", column: "role", values: ["student", "tutor", "system"] },
  { table: "tutor_messages", column: "content_kind", values: ["message", "suggestion", "consent_prompt", "system_note"] },
  { table: "tutor_instruction_assignments", column: "assignment_mode", values: ["deterministic", "explore", "manual_override"] },
  {
    table: "tutor_question_links",
    column: "relationship_type",
    values: ["current", "similar_retry", "simpler_variant", "harder_variant", "concept_extension"],
  },
  {
    table: "tutor_instruction_exposures",
    column: "exposure_type",
    values: ["hint", "explanation", "strategy", "similar_question_offer", "broader_coaching_offer", "consent_prompt"],
  },
  {
    table: "tutor_memory_summaries",
    column: "summary_type",
    values: ["teaching_profile", "chat_compaction", "recent_learning_pattern", "study_context"],
  },
];

function requireDbUrl(): string {
  const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.includes("placeholder")) {
    throw new Error("SUPABASE_DB_URL (or DATABASE_URL) is required and must not be a placeholder.");
  }
  return dbUrl;
}

function parseEnumValues(checkDef: string): string[] {
  const values: string[] = [];
  const re = /'([^']+)'::text/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(checkDef)) !== null) {
    values.push(match[1]);
  }
  return values;
}

function containsStudentAuthUidPredicate(predicate: string | null): boolean {
  if (!predicate) return false;
  return /student_id\s*=\s*auth\.uid\(\)/i.test(predicate);
}

export async function collectTutorSchemaProof(): Promise<SchemaProof> {
  const dbUrl = requireDbUrl();
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const columnsResult = await client.query<ColumnMeta>(
      `
      select table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name, ordinal_position
      `,
      [TUTOR_TABLES],
    );
    const indexesResult = await client.query<IndexMeta>(
      `
      select tablename, indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename, indexname
      `,
      [TUTOR_TABLES],
    );
    const checksResult = await client.query<CheckConstraintMeta>(
      `
      select c.relname as table_name, con.conname as constraint_name, pg_get_constraintdef(con.oid) as constraint_def
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any($1::text[])
        and con.contype = 'c'
      order by c.relname, con.conname
      `,
      [TUTOR_TABLES],
    );
    const fksResult = await client.query<ForeignKeyConstraintMeta>(
      `
      select c.relname as table_name, con.conname as constraint_name, pg_get_constraintdef(con.oid) as constraint_def
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any($1::text[])
        and con.contype = 'f'
      order by c.relname, con.conname
      `,
      [TUTOR_TABLES],
    );
    const rlsResult = await client.query<RlsMeta>(
      `
      select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any($1::text[])
      order by c.relname
      `,
      [TUTOR_TABLES],
    );
    const policiesResult = await client.query<PolicyMeta>(
      `
      select tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
      where schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename, policyname
      `,
      [TUTOR_TABLES],
    );

    const proof: SchemaProof = {
      generated_at: new Date().toISOString(),
      table_columns: Object.fromEntries(TUTOR_TABLES.map((table) => [table, []])) as Record<TutorTable, ColumnMeta[]>,
      indexes: Object.fromEntries(TUTOR_TABLES.map((table) => [table, []])) as Record<TutorTable, IndexMeta[]>,
      checks: Object.fromEntries(TUTOR_TABLES.map((table) => [table, []])) as Record<TutorTable, CheckConstraintMeta[]>,
      fks: Object.fromEntries(TUTOR_TABLES.map((table) => [table, []])) as Record<TutorTable, ForeignKeyConstraintMeta[]>,
      rls: Object.fromEntries(
        TUTOR_TABLES.map((table) => [
          table,
          { table_name: table, rls_enabled: false, rls_forced: false } as RlsMeta,
        ]),
      ) as Record<TutorTable, RlsMeta>,
      policies: Object.fromEntries(TUTOR_TABLES.map((table) => [table, []])) as Record<TutorTable, PolicyMeta[]>,
    };

    for (const row of columnsResult.rows) {
      proof.table_columns[row.table_name as TutorTable].push(row);
    }
    for (const row of indexesResult.rows) {
      proof.indexes[row.tablename as TutorTable].push(row);
    }
    for (const row of checksResult.rows) {
      proof.checks[row.table_name as TutorTable].push(row);
    }
    for (const row of fksResult.rows) {
      proof.fks[row.table_name as TutorTable].push(row);
    }
    for (const row of rlsResult.rows) {
      proof.rls[row.table_name as TutorTable] = row;
    }
    for (const row of policiesResult.rows) {
      proof.policies[row.tablename as TutorTable].push(row);
    }

    return proof;
  } finally {
    await client.end();
  }
}

export function assertTutorSchemaProof(proof: SchemaProof): string[] {
  const failures: string[] = [];

  for (const table of TUTOR_TABLES) {
    const actualColumns = new Set(proof.table_columns[table].map((column) => column.column_name));
    for (const requiredColumn of REQUIRED_COLUMNS[table]) {
      if (!actualColumns.has(requiredColumn)) {
        failures.push(`${table} is missing required column '${requiredColumn}'.`);
      }
    }
  }

  const clientTurnColumn = proof.table_columns.tutor_messages.find((column) => column.column_name === "client_turn_id");
  if (!clientTurnColumn) {
    failures.push("tutor_messages.client_turn_id is missing.");
  } else if (clientTurnColumn.udt_name !== "uuid") {
    failures.push(`tutor_messages.client_turn_id must be uuid (found ${clientTurnColumn.udt_name}).`);
  }

  const idempotencyUniqueIndex = proof.indexes.tutor_messages.find((index) =>
    /\bunique\s+index\b/i.test(index.indexdef)
    && /\(student_id,\s*conversation_id,\s*client_turn_id\)/i.test(index.indexdef)
    && /where\s+\(?client_turn_id\s+is\s+not\s+null\)?/i.test(index.indexdef),
  );
  if (!idempotencyUniqueIndex) {
    failures.push(
      "Missing unique index for idempotency on tutor_messages(student_id, conversation_id, client_turn_id) WHERE client_turn_id IS NOT NULL.",
    );
  }

  for (const enumCheck of REQUIRED_ENUMS) {
    const matchingCheck = proof.checks[enumCheck.table].find((check) =>
      check.constraint_def.includes(`${enumCheck.column}`),
    );
    if (!matchingCheck) {
      failures.push(`Missing enum check constraint for ${enumCheck.table}.${enumCheck.column}.`);
      continue;
    }
    const actual = parseEnumValues(matchingCheck.constraint_def).sort();
    const expected = [...enumCheck.values].sort();
    if (actual.length !== expected.length || actual.some((value, i) => value !== expected[i])) {
      failures.push(
        `Enum mismatch for ${enumCheck.table}.${enumCheck.column}. Expected [${expected.join(", ")}], found [${actual.join(", ")}].`,
      );
    }
  }

  for (const table of TUTOR_TABLES) {
    const rls = proof.rls[table];
    if (!rls?.rls_enabled) {
      failures.push(`RLS is not enabled for ${table}.`);
    }
    const tablePolicies = proof.policies[table];
    const selectPolicy = tablePolicies.find((policy) =>
      (policy.cmd === "SELECT" || policy.cmd === "ALL") && containsStudentAuthUidPredicate(policy.qual),
    );
    if (!selectPolicy) {
      failures.push(`Missing student-scoped SELECT policy for ${table}.`);
    }
    const insertPolicy = tablePolicies.find((policy) =>
      (policy.cmd === "INSERT" || policy.cmd === "ALL")
      && (containsStudentAuthUidPredicate(policy.with_check) || containsStudentAuthUidPredicate(policy.qual)),
    );
    if (!insertPolicy) {
      failures.push(`Missing student-scoped INSERT policy for ${table}.`);
    }
  }

  return failures;
}

function printProof(proof: SchemaProof): void {
  for (const table of TUTOR_TABLES) {
    console.log(`\n[${table}]`);
    console.log("columns:");
    for (const column of proof.table_columns[table]) {
      console.log(
        `  - ${column.column_name} ${column.data_type} (${column.is_nullable === "YES" ? "nullable" : "not null"}) default=${column.column_default ?? "null"}`,
      );
    }
    console.log("indexes:");
    for (const index of proof.indexes[table]) {
      console.log(`  - ${index.indexname}: ${index.indexdef}`);
    }
    console.log("checks:");
    for (const check of proof.checks[table]) {
      console.log(`  - ${check.constraint_name}: ${check.constraint_def}`);
    }
    console.log("foreign keys:");
    for (const fk of proof.fks[table]) {
      console.log(`  - ${fk.constraint_name}: ${fk.constraint_def}`);
    }
    const rls = proof.rls[table];
    console.log(`rls: enabled=${rls.rls_enabled} forced=${rls.rls_forced}`);
    console.log("policies:");
    for (const policy of proof.policies[table]) {
      console.log(
        `  - ${policy.policyname}: cmd=${policy.cmd} qual=${policy.qual ?? "null"} with_check=${policy.with_check ?? "null"}`,
      );
    }
  }
}

export async function runTutorSchemaProof(argv: string[]): Promise<void> {
  const assertOnly = argv.includes("--assert-only");
  const outputPath = path.join(process.cwd(), "tmp", "tutor_schema_proof.latest.json");
  const proof = await collectTutorSchemaProof();
  const failures = assertTutorSchemaProof(proof);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

  if (!assertOnly) {
    console.log("Tutor schema proof (live DB):");
    printProof(proof);
    console.log(`\nSaved proof JSON to: ${outputPath}`);
  }

  if (failures.length > 0) {
    console.error("\nTutor schema contract assertions failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nTutor schema contract assertions passed.");
}

const isEntrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isEntrypoint) {
  runTutorSchemaProof(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Tutor schema proof failed: ${message}`);
    process.exit(1);
  });
}
