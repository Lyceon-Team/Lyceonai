/**
 * @spec [Coding Standards §14; CLAUDE.md "Unified code across agents & sessions"]
 * @implemented 2026-09-22
 *
 * plain English: Removes comments from TypeScript/JavaScript source, leaving
 * only the code. Static contract tests use this before asserting that a term
 * is absent from a module.
 *
 * WHY THIS EXISTS. A static gate that greps raw source for a banned term is
 * satisfied by prose about the term. The gate then passes against code that
 * violates it, as long as a comment nearby mentions it — and the comment a
 * careful author writes explaining *why the term must never appear* is
 * exactly the prose that blinds the gate. This bit twice in this repo
 * (bigquery-archive-partitioning B3.11 and B3.6, 2026-09-22, where a
 * trade-offs comment quoting `require_partition_filter = true` kept the gate
 * green after the real setting had been deleted). Strip comments first, then
 * assert.
 *
 * expected outcome: the same source with every line comment and block comment
 * replaced by a single space, and every string literal, template literal and
 * regex literal left byte-identical.
 *
 * trade-offs:
 *  - Hand-written scanner rather than a parser. TypeScript's own
 *    `ts.createSourceFile` would be exact, but pulls the compiler into every
 *    test that wants one boolean. This scanner handles the four contexts that
 *    can contain a `/` or a quote; it is not a tokenizer and does not try to
 *    be one.
 *  - Comments become a single space, not nothing, so a comment between two
 *    identifiers cannot silently fuse them into a third.
 *  - Five older test files carry their own private regex `stripComments`.
 *    They are behaviourally different from this one (one is line-based, one
 *    also strips JSX comment expressions), so they are NOT mechanically
 *    replaced here — migrating each needs its own check that its gates still
 *    redden where they should. This is the canonical one; new callers use it.
 *
 * edge cases:
 *  - Regex-vs-division ambiguity (`a / b` against `/re/`) is resolved by the
 *    standard heuristic: a `/` starts a regex only when the previous
 *    significant character cannot end an expression. A misread can only make
 *    this function preserve MORE text than necessary, never strip code.
 *  - An unterminated block comment runs to end of input rather than throwing;
 *    such a file would not compile anyway.
 */

/** Characters that, as the last significant char, mean a following `/` divides. */
const DIVIDES_AFTER = /[A-Za-z0-9_$)\]}]/;

export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let lastSignificant = "";

  const n = source.length;
  while (i < n) {
    const c = source[i] as string;
    const next = i + 1 < n ? (source[i + 1] as string) : "";

    // Line comment
    if (c === "/" && next === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i += 1;
      out += " ";
      continue;
    }

    // Block comment
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }

    // String literal
    if (c === "'" || c === '"') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        const d = source[i] as string;
        out += d;
        i += 1;
        if (d === "\\") {
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (d === quote) break;
        if (d === "\n") break; // unterminated; JS forbids it, so stop here
      }
      lastSignificant = quote;
      continue;
    }

    // Template literal, including nested ${...} substitutions
    if (c === "`") {
      let depth = 0;
      out += c;
      i += 1;
      while (i < n) {
        const d = source[i] as string;
        out += d;
        i += 1;
        if (d === "\\") {
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (d === "$" && source[i] === "{") {
          out += "{";
          i += 1;
          depth += 1;
          continue;
        }
        if (d === "}" && depth > 0) {
          depth -= 1;
          continue;
        }
        if (d === "`" && depth === 0) break;
      }
      lastSignificant = "`";
      continue;
    }

    // Regex literal
    if (c === "/" && !DIVIDES_AFTER.test(lastSignificant)) {
      out += c;
      i += 1;
      let inClass = false;
      while (i < n) {
        const d = source[i] as string;
        out += d;
        i += 1;
        if (d === "\\") {
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        else if (d === "\n") break;
      }
      lastSignificant = "/";
      continue;
    }

    out += c;
    if (!/\s/.test(c)) lastSignificant = c;
    i += 1;
  }

  return out;
}

/**
 * HCL variant. Terraform accepts `#` line comments in addition to the two
 * C-style forms, so a gate reading `.tf` source needs all three removed.
 *
 * plain English: same guarantee as `stripComments`, plus `#` to end of line.
 *
 * trade-offs: HCL heredocs (`<<EOF ... EOF`) are NOT tracked. A `#` inside a
 * heredoc body would be stripped as a comment. No `.tf` file in this repo
 * uses a heredoc; a caller that introduces one must revisit this.
 *
 * edge cases: `#` inside a quoted string is preserved, because the string
 * scanner consumes the whole literal before this sees the `#`.
 */
export function stripHclComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;

  // Strip `#` comments first, leaving strings intact, then hand the rest to
  // the shared scanner for `//` and block comments.
  while (i < n) {
    const c = source[i] as string;
    if (c === "#") {
      while (i < n && source[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        const d = source[i] as string;
        out += d;
        i += 1;
        if (d === "\\") {
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (d === quote || d === "\n") break;
      }
      continue;
    }
    out += c;
    i += 1;
  }

  return stripComments(out);
}
