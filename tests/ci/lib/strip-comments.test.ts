/**
 * @spec [Coding Standards §14]
 * @implemented 2026-09-22
 *
 * plain English: proves `stripComments` removes comments and ONLY comments.
 * A stripper that also ate string literals would make every gate built on it
 * pass vacuously — the failure mode it exists to prevent, one level up.
 */
import { describe, it, expect } from "vitest";
import { stripComments, stripHclComments } from "./strip-comments";

describe("stripComments", () => {
  it("removes line comments", () => {
    expect(stripComments("const a = 1; // archive\n")).not.toContain("archive");
  });

  it("removes block comments, including multi-line JSDoc", () => {
    const src = "/**\n * archive this\n */\nconst a = 1;\n";
    expect(stripComments(src)).not.toContain("archive");
    expect(stripComments(src)).toContain("const a = 1;");
  });

  it("keeps a term that appears in a string literal", () => {
    // The gate must still fail on real code. If the stripper ate strings, a
    // module could call insertRows("archive", ...) and pass.
    expect(stripComments('const t = "archive";')).toContain("archive");
    expect(stripComments("const t = 'archive';")).toContain("archive");
  });

  it("keeps a term inside a template literal and its substitutions", () => {
    const src = "const t = `x ${archive} y`;";
    expect(stripComments(src)).toContain("archive");
  });

  it("does not treat // inside a string as a comment", () => {
    const src = 'const u = "https://example.test/archive";\nconst b = 2;';
    const out = stripComments(src);
    expect(out).toContain("archive");
    expect(out).toContain("const b = 2;");
  });

  it("does not treat a division as a regex start", () => {
    const src = "const r = a / b; const s = c / d; // archive\n";
    const out = stripComments(src);
    expect(out).not.toContain("archive");
    expect(out).toContain("const s = c / d;");
  });

  it("keeps a regex literal containing a slash-slash", () => {
    const src = "const re = /https:\\/\\/archive/;";
    expect(stripComments(src)).toContain("archive");
  });

  it("separates rather than fuses tokens across a removed comment", () => {
    expect(stripComments("a/* c */b")).not.toContain("ab");
  });

  it("leaves comment-free source byte-identical", () => {
    const src = 'const a = 1;\nconst b = "two";\n';
    expect(stripComments(src)).toBe(src);
  });
});

describe("stripHclComments", () => {
  it("removes # line comments", () => {
    expect(
      stripHclComments("a = 1 # expiration_ms = 63072000000\n"),
    ).not.toContain("63072000000");
  });

  it("removes // and block comments too", () => {
    expect(stripHclComments("a = 1 // gone\n/* also gone */\nb = 2")).toMatch(
      /b = 2/,
    );
    expect(
      stripHclComments("a = 1 // gone\n/* also gone */\nb = 2"),
    ).not.toContain("gone");
  });

  it("keeps a # inside a quoted string", () => {
    expect(stripHclComments('uri = "https://x.test/a#frag"')).toContain(
      "#frag",
    );
  });

  it("keeps real settings next to a comment quoting them", () => {
    // The M54 shape: the comment says the thing, the code no longer does.
    const withCode =
      "require_partition_filter = true # require_partition_filter = true\n";
    const withoutCode = "# require_partition_filter = true\n";
    expect(stripHclComments(withCode)).toContain(
      "require_partition_filter = true",
    );
    expect(stripHclComments(withoutCode)).not.toContain(
      "require_partition_filter",
    );
  });
});
