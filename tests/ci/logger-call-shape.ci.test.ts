/**
 * @spec [Coding Standards §12.1 (structured logs); register F-34, F-35; owner ruling Brief 6] |
 *   @implemented [2026-09-30] |
 * plain English: every `logger.*` call in the files the F-24 triage flagged passes the logger's
 * full signature — `(component, operation, message, …)` — with a literal UPPER_SNAKE component, a
 * literal snake_case event name and a message. Twelve calls did not: ten passed the prose (and
 * data) in the first slots, so production JSON lines had no `message` and an object in `event`;
 * two passed `{ studentId, summaryType }` as the `context` argument, which the logger discards.
 *
 * Why a source check as well as tsc: `pnpm check` is not a CI gate yet (41 known errors, F-24),
 * so tsc alone would not stop a short-arity call from coming back. This file is the gate until it
 * is. Each fixed site also gets its own case, found by its event name and asserted to carry its
 * message, so one site regressing names itself.
 *
 * The logger's behaviour at runtime is proven separately where it is cheap to drive: the
 * diagnostic baseline no-op (tests/ci/diagnostic.handler-pg.ci.test.ts) and the tutor-compaction
 * NOTIFY failure (server/__tests__/tutor-compaction.test.ts).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const FILES = [
  "server/routes/practice-canonical.ts",
  "server/routes/diagnostic-routes.ts",
  "server/services/tutor-compaction.ts",
] as const;
const LEVELS = new Set(["debug", "info", "warn", "error"]);

type LoggerCall = {
  file: string;
  line: number;
  level: string;
  args: ts.NodeArray<ts.Expression>;
  component: string | null;
  operation: string | null;
  message: string | null;
};

/** A named constant (`MASTERY_EMISSION_COMPONENT`, `MASTERY_EMISSION_EVENT.SKIPPED`). */
function isConstantReference(node: ts.Expression | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node))
  );
}

function literal(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function loggerCalls(file: string): LoggerCall[] {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const calls: LoggerCall[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "logger" &&
      LEVELS.has(node.expression.name.text)
    ) {
      const messageNode = node.arguments[2];
      calls.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        level: node.expression.name.text,
        args: node.arguments,
        component: literal(node.arguments[0]),
        operation: literal(node.arguments[1]),
        message:
          literal(messageNode) ??
          (messageNode && ts.isTemplateExpression(messageNode)
            ? messageNode.getText()
            : null),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

const CALLS = FILES.flatMap(loggerCalls);

/** The twelve sites the F-24 triage flagged (F-34, F-35): file, event name, message. */
const FIXED_SITES: ReadonlyArray<{
  file: (typeof FILES)[number];
  component: string;
  operation: string;
  message: string;
}> = [
  {
    file: "server/routes/practice-canonical.ts",
    component: "PRACTICE_ANSWER",
    operation: "rate_limit_config_unavailable",
    message: "Rate limiter config unavailable; rejecting request (fail-closed)",
  },
  {
    file: "server/routes/practice-canonical.ts",
    component: "PRACTICE_SESSION",
    operation: "quota_dry_run_unavailable",
    message: "Quota dry-run unavailable at session creation; failing closed",
  },
  {
    file: "server/routes/practice-canonical.ts",
    component: "DIAGNOSTIC_BASELINE",
    operation: "baseline_already_captured",
    message: "[diagnostic] baseline already captured (idempotent no-op)",
  },
  {
    file: "server/routes/practice-canonical.ts",
    component: "DIAGNOSTIC_BASELINE",
    operation: "baseline_insert_failed",
    message: "[diagnostic] baseline insert failed (non-fatal)",
  },
  {
    file: "server/routes/practice-canonical.ts",
    component: "DIAGNOSTIC_BASELINE",
    operation: "baseline_captured",
    message: "[diagnostic] baseline captured",
  },
  {
    file: "server/routes/diagnostic-routes.ts",
    component: "DIAGNOSTIC",
    operation: "pool_question_invalid",
    message: "[diagnostic] skipping invalid question from pool",
  },
  {
    file: "server/routes/diagnostic-routes.ts",
    component: "DIAGNOSTIC",
    operation: "insufficient_domain_coverage",
    message: "[diagnostic] insufficient domain coverage",
  },
  {
    file: "server/routes/diagnostic-routes.ts",
    component: "DIAGNOSTIC",
    operation: "domain_insufficient_questions",
    message: "[diagnostic] domain has insufficient questions",
  },
  {
    file: "server/routes/diagnostic-routes.ts",
    component: "DIAGNOSTIC",
    operation: "pool_below_requirement",
    message: "[diagnostic] total pool size below requirement",
  },
  {
    file: "server/routes/diagnostic-routes.ts",
    component: "DIAGNOSTIC",
    operation: "session_created",
    message: "[diagnostic] session created",
  },
  {
    file: "server/services/tutor-compaction.ts",
    component: "TUTOR_COMPACTION",
    operation: "notify_failed",
    message:
      "Failed to fire memory_summary_updated NOTIFY; cache invalidation may be delayed",
  },
  {
    file: "server/services/tutor-compaction.ts",
    component: "TUTOR_COMPACTION",
    operation: "notify_error",
    message: "Unexpected error firing NOTIFY",
  },
];

const where = (c: LoggerCall): string => `${c.file}:${c.line}`;

describe("logger calls carry (component, operation, message) — F-34, F-35", () => {
  it("presence: the scan finds the logger calls in every file", () => {
    for (const file of FILES) {
      expect(CALLS.filter((c) => c.file === file).length, file).toBeGreaterThan(
        3,
      );
    }
  });

  it("every call passes a component, a snake_case event name and a message (literals are checked; named constants accepted)", () => {
    const componentOk = (c: LoggerCall): boolean =>
      c.component !== null
        ? /^[A-Z][A-Z0-9_]*$/.test(c.component)
        : isConstantReference(c.args[0]);
    const operationOk = (c: LoggerCall): boolean =>
      c.operation !== null
        ? /^[a-z][a-z0-9_]*$/.test(c.operation)
        : isConstantReference(c.args[1]);
    const messageOk = (c: LoggerCall): boolean =>
      c.message !== null || isConstantReference(c.args[2]);
    const bad = CALLS.filter(
      (c) =>
        c.args.length < 3 ||
        !componentOk(c) ||
        !operationOk(c) ||
        !messageOk(c),
    ).map((c) => `${where(c)} logger.${c.level}(${c.args.length} args)`);
    expect(bad).toEqual([]);
  });

  it("no call passes a 'studentId' key in the context slot (the logger keeps only userId/requestId/ip there)", () => {
    const bad = CALLS.filter((c) => {
      const contextIndex = c.level === "error" ? 5 : 4;
      const context = c.args[contextIndex];
      return (
        context !== undefined &&
        ts.isObjectLiteralExpression(context) &&
        context.properties.some(
          (p) =>
            (ts.isShorthandPropertyAssignment(p) ||
              ts.isPropertyAssignment(p)) &&
            ts.isIdentifier(p.name) &&
            !["userId", "requestId", "ip"].includes(p.name.text),
        )
      );
    }).map(where);
    expect(bad).toEqual([]);
  });

  for (const site of FIXED_SITES) {
    it(`${site.file}: ${site.component}/${site.operation} carries its message`, () => {
      const matches = CALLS.filter(
        (c) =>
          c.file === site.file &&
          c.component === site.component &&
          c.operation === site.operation,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.message).toBe(site.message);
    });
  }
});
