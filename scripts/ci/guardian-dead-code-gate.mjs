#!/usr/bin/env node
/**
 * Guardian dead-code gate: no unused export and no test-only module in guardian scope.
 *
 * @spec [Guardian closeout brief 2026-10-01, Part B step 4 ("the unused-export tool, scoped to
 *       the guardian paths, must report zero findings")] | @implemented [2026-10-01]
 *
 * plain English: builds the repository's import graph with the TypeScript compiler API (already
 * a dependency, so no new tool is added) and reports, for every file in GUARDIAN SCOPE:
 *   1. UNUSED EXPORT — an exported name that no other file imports, re-exports or destructures
 *      from a dynamic `import()`. Test files count as importers: an export a test drives is
 *      exercised code.
 *   2. TEST-ONLY MODULE — a module that only test files import, so nothing in the shipped app
 *      can reach it (test helpers named `*test-harness*` / `*.fixture.*` are the exception:
 *      they exist for tests).
 * Exit 1 on any finding. `--json` prints the findings as JSON.
 *
 * GUARDIAN SCOPE: every non-test .ts/.tsx file under client/src, server, packages/shared/src or
 * apps/api/src whose path names "guardian", plus the shared components the guardian surface
 * renders (SCOPE_EXTRA). Excluded: server/lib/stripe/** — billing belongs to `cleanup`.
 *
 * Name resolution: `export * from` is followed (a name used through a barrel counts for the
 * module that defines it); a namespace import (`import * as X`) or a dynamic `import()` whose
 * result is not destructured marks every export of the target used — conservative, so the
 * gate can under-report but never reports a used export.
 *
 * Zod-first (coding standards §7.2): `export type T = z.infer<typeof tSchema>` makes the schema
 * the source of the type, so a used `T` counts as a use of `tSchema`. Without this, the schema
 * could neither stay exported (this gate) nor be un-exported (`no-unused-vars` rejects a value
 * used only as a type).
 *
 * Trade-off: names are matched by module and spelling, not by the type checker's symbol
 * identity, so an export used only via `typeof import("…")` would be reported; none exists.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes("--json");

const SCOPE_EXTRA = [
  "client/src/components/mastery/MasteryMeter.tsx",
];
const SCOPE_EXCLUDE = [/^server\/lib\/stripe\//];
const TEST_FILE = /(\.test\.tsx?$|^tests\/|\/__tests__\/|\.spec\.ts$)/;
const TEST_HELPER = /(test-harness|\.fixture\.|\/fixtures?\/)/;

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.tsx"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((f) => f && !f.endsWith(".d.ts") && !f.startsWith("node_modules/"))
  .filter((f) => fs.existsSync(f));

const inScope = (f) =>
  !TEST_FILE.test(f) &&
  !SCOPE_EXCLUDE.some((r) => r.test(f)) &&
  (SCOPE_EXTRA.includes(f) ||
    (/guardian/i.test(f) &&
      /^(client\/src|server|packages\/shared\/src|apps\/api\/src)\//.test(f)));

const configFile = ts.readConfigFile(path.join(ROOT, "tsconfig.json"), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT).options;
const host = ts.createCompilerHost(options);

function resolve(spec, fromFile) {
  const r = ts.resolveModuleName(spec, path.join(ROOT, fromFile), options, host)
    .resolvedModule;
  if (!r || r.isExternalLibraryImport) return null;
  const rel = path.relative(ROOT, r.resolvedFileName).split(path.sep).join("/");
  return rel.endsWith(".d.ts") ? null : rel;
}

/** used[file] = Set of names imported from it by OTHER files ("*" = all). */
const used = new Map();
/** importers[file] = Set of files that import it. */
const importers = new Map();
/** starEdges: barrel -> modules it `export *`s. */
const starEdges = new Map();
/** exportsOf[file] = Map name -> line. */
const exportsOf = new Map();
/** inferredFrom[file] = Map exported type name -> the schema it is `z.infer`red from. */
const inferredFrom = new Map();

const add = (m, k, v) => {
  if (!m.has(k)) m.set(k, new Set());
  m.get(k).add(v);
};

function bindingNames(pattern) {
  if (!ts.isObjectBindingPattern(pattern)) return null;
  const names = [];
  for (const el of pattern.elements) {
    if (el.dotDotDotToken) return null;
    const prop = el.propertyName ?? el.name;
    if (!ts.isIdentifier(prop) && !ts.isStringLiteral(prop)) return null;
    names.push(prop.text);
  }
  return names;
}

/** `z.infer<typeof X>` / `z.input<…>` / `z.output<…>` → "X", else null. */
function inferredSchema(type) {
  if (!ts.isTypeReferenceNode(type) || !type.typeArguments?.length) return null;
  const name = type.typeName.getText();
  if (!/^z\.(infer|input|output)$/.test(name)) return null;
  const arg = type.typeArguments[0];
  return ts.isTypeQueryNode(arg) && ts.isIdentifier(arg.exprName) ? arg.exprName.text : null;
}

function collectExports(sf, rel) {
  const out = new Map();
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : [];
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (exported) {
      if (isDefault) out.set("default", line(st));
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations)
          if (ts.isIdentifier(d.name)) out.set(d.name.text, line(d));
      } else if (st.name && ts.isIdentifier(st.name)) {
        out.set(st.name.text, line(st));
        const schema = ts.isTypeAliasDeclaration(st) ? inferredSchema(st.type) : null;
        if (schema) add(inferredFrom, rel, [st.name.text, schema]);
      }
    } else if (ts.isExportAssignment(st)) out.set("default", line(st));
    else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause) {
      if (ts.isNamedExports(st.exportClause))
        for (const el of st.exportClause.elements) out.set(el.name.text, line(el));
    }
  }
  exportsOf.set(rel, out);
}

for (const rel of files) {
  const text = fs.readFileSync(rel, "utf8");
  const sf = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (inScope(rel)) collectExports(sf, rel);

  const use = (target, name) => {
    if (!target || target === rel) return;
    add(used, target, name);
    add(importers, target, rel);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolve(node.moduleSpecifier.text, rel);
      const clause = node.importClause;
      if (!clause) use(target, "*side-effect*");
      else {
        if (clause.name) use(target, "default");
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) use(target, "*");
        if (nb && ts.isNamedImports(nb))
          for (const el of nb.elements) use(target, (el.propertyName ?? el.name).text);
        if (!clause.name && !nb) use(target, "*side-effect*");
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const target = resolve(node.moduleSpecifier.text, rel);
      if (!node.exportClause) {
        if (target && target !== rel) {
          add(starEdges, rel, target);
          add(importers, target, rel);
        }
      } else if (ts.isNamespaceExport(node.exportClause)) use(target, "*");
      else for (const el of node.exportClause.elements) use(target, (el.propertyName ?? el.name).text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const target = resolve(node.arguments[0].text, rel);
      let p = node.parent;
      if (p && ts.isAwaitExpression(p)) p = p.parent;
      while (p && ts.isParenthesizedExpression(p)) p = p.parent;
      let names = null;
      if (p && ts.isVariableDeclaration(p)) names = bindingNames(p.name);
      else if (p && ts.isPropertyAccessExpression(p)) names = [p.name.text];
      if (names) for (const n of names) use(target, n);
      else use(target, "*");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Propagate names used through `export *` barrels to the module that defines them.
let changed = true;
while (changed) {
  changed = false;
  for (const [barrel, targets] of starEdges) {
    const names = used.get(barrel);
    if (!names) continue;
    for (const t of targets)
      for (const n of names) {
        if (n === "*side-effect*") continue;
        if (n !== "*" && exportsOf.get(barrel)?.has(n)) continue;
        if (!used.get(t)?.has(n)) {
          add(used, t, n);
          changed = true;
        }
      }
  }
}

// A used inferred type is a use of its schema (Zod-first).
for (const [file, pairs] of inferredFrom) {
  const names = used.get(file);
  if (!names) continue;
  for (const [typeName, schema] of pairs) if (names.has(typeName)) add(used, file, schema);
}

const findings = [];
for (const [rel, exps] of [...exportsOf].sort()) {
  const names = used.get(rel) ?? new Set();
  if (!names.has("*"))
    for (const [name, line] of exps)
      if (!names.has(name))
        findings.push({ kind: "unused-export", file: rel, line, name });
  if (!TEST_HELPER.test(rel)) {
    const imp = [...(importers.get(rel) ?? [])];
    if (imp.length > 0 && imp.every((f) => TEST_FILE.test(f)))
      findings.push({ kind: "test-only-module", file: rel, line: 1, name: imp.join(", ") });
    if (imp.length === 0)
      findings.push({ kind: "unimported-module", file: rel, line: 1, name: "(no importer)" });
  }
}

if (JSON_OUT) console.log(JSON.stringify(findings, null, 2));
else {
  for (const f of findings) console.log(`${f.kind}  ${f.file}:${f.line}  ${f.name}`);
  console.log(
    `GUARDIAN DEAD-CODE GATE: ${findings.length === 0 ? "PASS" : "FAIL"} (${exportsOf.size} guardian-scope modules, ${findings.length} finding(s))`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
