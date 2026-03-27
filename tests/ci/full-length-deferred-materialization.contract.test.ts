import { beforeEach, describe, expect, it, vi } from "vitest";

type TableRow = Record<string, any>;

type DbState = {
  test_forms: TableRow[];
  test_form_items: TableRow[];
  questions: TableRow[];
  full_length_adaptive_config: TableRow[];
  full_length_exam_sessions: TableRow[];
  full_length_exam_modules: TableRow[];
  full_length_exam_questions: TableRow[];
  full_length_exam_responses: TableRow[];
};

let db: DbState;

function cloneRow<T extends TableRow>(row: T): T {
  return JSON.parse(JSON.stringify(row));
}

function applyFilters(rows: TableRow[], filters: Array<(row: TableRow) => boolean>): TableRow[] {
  return rows.filter((row) => filters.every((fn) => fn(row)));
}

function applyOrder(rows: TableRow[], orderBy: { column: string; ascending: boolean } | null): TableRow[] {
  if (!orderBy) return rows;
  const { column, ascending } = orderBy;
  return [...rows].sort((a, b) => {
    const av = a[column];
    const bv = b[column];
    if (av === bv) return 0;
    if (av == null) return ascending ? -1 : 1;
    if (bv == null) return ascending ? 1 : -1;
    return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

class MockBuilder {
  private readonly table: keyof DbState;
  private readonly state: DbState;
  private filters: Array<(row: TableRow) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitValue: number | null = null;
  private operation: "select" | "insert" | "update" = "select";
  private inserted: TableRow[] = [];
  private patch: TableRow = {};

  constructor(table: keyof DbState, state: DbState) {
    this.table = table;
    this.state = state;
  }

  select(_columns?: string, _opts?: { head?: boolean; count?: "exact" }) {
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  insert(payload: TableRow | TableRow[]) {
    this.operation = "insert";
    const rows = Array.isArray(payload) ? payload : [payload];
    const tableRows = this.state[this.table] as TableRow[];

    for (const row of rows) {
      const rowWithDefaults = { ...row };
      if (!rowWithDefaults.id) {
        if (this.table === "full_length_exam_sessions") {
          rowWithDefaults.id = "sess-1";
        } else if (this.table === "full_length_exam_modules") {
          rowWithDefaults.id = `mod-${rowWithDefaults.section}-${rowWithDefaults.module_index}`;
        } else {
          rowWithDefaults.id = `row-${tableRows.length + this.inserted.length + 1}`;
        }
      }
      this.inserted.push(cloneRow(rowWithDefaults));
    }

    tableRows.push(...this.inserted.map(cloneRow));
    return this;
  }

  update(patch: TableRow) {
    this.operation = "update";
    this.patch = patch;
    return this;
  }

  maybeSingle() {
    const result = this.execute();
    if (result.error) return Promise.resolve({ data: null, error: result.error });
    const first = result.data?.[0] ?? null;
    return Promise.resolve({ data: first, error: null });
  }

  single() {
    const result = this.execute();
    if (result.error) return Promise.resolve({ data: null, error: result.error });
    const first = result.data?.[0] ?? null;
    if (!first) {
      return Promise.resolve({ data: null, error: { message: "No rows" } });
    }
    return Promise.resolve({ data: first, error: null });
  }

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    const result = this.execute();
    return Promise.resolve(result).then(resolve, reject);
  }

  private execute() {
    if (this.operation === "insert") {
      return { data: this.inserted.map(cloneRow), error: null };
    }

    if (this.operation === "update") {
      const tableRows = this.state[this.table] as TableRow[];
      const matched = applyFilters(tableRows, this.filters);
      for (const row of matched) {
        Object.assign(row, this.patch);
      }
      const ordered = applyOrder(matched.map(cloneRow), this.orderBy);
      const limited = this.limitValue == null ? ordered : ordered.slice(0, this.limitValue);
      return { data: limited, error: null };
    }

    const tableRows = this.state[this.table] as TableRow[];
    const filtered = applyFilters(tableRows, this.filters);
    const ordered = applyOrder(filtered.map(cloneRow), this.orderBy);
    const limited = this.limitValue == null ? ordered : ordered.slice(0, this.limitValue);
    return { data: limited, error: null };
  }
}

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (table: keyof DbState) => new MockBuilder(table, db),
  })),
}));

vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => supabaseMocks.getSupabaseAdmin(),
}));

function seedPublishedForm() {
  const formId = "form-1";
  db.test_forms.push({
    id: formId,
    status: "published",
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });

  const buildItems = (section: "rw" | "math", moduleIndex: 1 | 2, count: number) => {
    for (let i = 1; i <= count; i += 1) {
      const canonicalId = `${section.toUpperCase()}${moduleIndex}-${String(i).padStart(2, "0")}`;
      const questionId = `${section}-${moduleIndex}-${i}`;
      db.test_form_items.push({
        section,
        module_index: moduleIndex,
        ordinal: i,
        question_id: canonicalId,
        form_id: formId,
      });
      db.questions.push({
        id: questionId,
        canonical_id: canonicalId,
        question_type: "multiple_choice",
        section_code: section === "rw" ? "RW" : "M",
        section: section === "rw" ? "RW" : "Math",
        stem: `Q${canonicalId}`,
        options: [
          { key: "A", text: "A" },
          { key: "B", text: "B" },
          { key: "C", text: "C" },
          { key: "D", text: "D" },
        ],
        difficulty: 2,
        domain: "Domain",
        skill: "Skill",
        subskill: "Subskill",
        source_type: 0,
        diagram_present: false,
        tags: [],
        competencies: [],
        answer_choice: "A",
        answer: "A",
        answer_text: "Answer",
        explanation: "Because",
        exam: "SAT",
        structure_cluster_id: null,
      });
    }
  };

  buildItems("rw", 1, 27);
  buildItems("rw", 2, 27);
  buildItems("math", 1, 22);
  buildItems("math", 2, 22);

  return formId;
}

describe("Full-length deferred materialization gates", () => {
  beforeEach(() => {
    db = {
      test_forms: [],
      test_form_items: [],
      questions: [],
      full_length_adaptive_config: [],
      full_length_exam_sessions: [],
      full_length_exam_modules: [],
      full_length_exam_questions: [],
      full_length_exam_responses: [],
    };
  });

  it("creates only RW1/Math1 question rows at session start", async () => {
    const formId = seedPublishedForm();
    const { createExamSession } = await import("../../apps/api/src/services/fullLengthExam");

    const session = await createExamSession({
      userId: "student-1",
      testFormId: formId,
      clientInstanceId: "client-1",
    });

    expect(session.id).toBe("sess-1");
    expect(db.full_length_exam_modules.length).toBe(4);

    const moduleIndexById = new Map(
      db.full_length_exam_modules.map((mod) => [String(mod.id), Number(mod.module_index)])
    );

    const materializedModuleIndexes = new Set(
      db.full_length_exam_questions.map((row) => moduleIndexById.get(String(row.module_id)))
    );

    expect(materializedModuleIndexes.has(1)).toBe(true);
    expect(materializedModuleIndexes.has(2)).toBe(false);

    expect(db.full_length_exam_questions.length).toBe(27 + 22);
  });

  it("fails closed when module-2 bucket persists without deferred materialization proof", async () => {
    const { submitModule } = await import("../../apps/api/src/services/fullLengthExam");

    db.full_length_exam_sessions.push({
      id: "sess-1",
      user_id: "student-1",
      status: "in_progress",
      current_section: "rw",
      current_module: 1,
      test_form_id: null,
      seed: "seed-1",
    });

    db.full_length_adaptive_config.push({
      id: "cfg-rw",
      section: "rw",
      hard_cutoff: 21,
      bucket_mode: "two_bucket",
      active: true,
    });

    db.full_length_exam_modules.push(
      {
        id: "mod-rw-1",
        session_id: "sess-1",
        section: "rw",
        module_index: 1,
        status: "submitted",
        ends_at: new Date().toISOString(),
      },
      {
        id: "mod-rw-2",
        session_id: "sess-1",
        section: "rw",
        module_index: 2,
        status: "not_started",
        difficulty_bucket: null,
      }
    );

    await expect(
      submitModule({
        sessionId: "sess-1",
        userId: "student-1",
      })
    ).rejects.toThrow(
      "Module 2 bucket persisted without deferred materialization proof from persisted Module 1 outcomes"
    );
  });
});
