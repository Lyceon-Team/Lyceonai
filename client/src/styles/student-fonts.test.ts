/**
 * @spec [student-UI register UI-12, UI-40; DESIGN.md §1 (Source Serif 4 600, Source Sans 3
 *        400/500/600, self-hosted); owner approval (Karl) 2026-10-02 of these two files with the
 *        OFL text committed alongside] | @implemented [2026-10-02]
 *
 * plain English: the two approved WOFF2 files are the exact bytes approved (sha256), their OFL
 * licence texts sit beside them, and student-tokens.css declares an @font-face for each, served
 * from the app's own origin (no third-party request).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FONT_DIR = path.resolve(__dirname, "../../public/fonts");
const TOKENS = readFileSync(
  path.resolve(__dirname, "student-tokens.css"),
  "utf8",
);

const APPROVED = [
  {
    family: "Source Serif 4",
    file: "source-serif-4-latin-variable.woff2",
    sha256: "f2b7e1cf1d277b7608231868135648f8ad8e2b58d8e97ca088bee15dc357bee7",
    licence: "OFL-SourceSerif4.md",
  },
  {
    family: "Source Sans 3",
    file: "source-sans-3-latin-variable.woff2",
    sha256: "19143dca075972bc84e3fd9eab7416dd40cc565dccb2435a044bdfabe060c7d5",
    licence: "OFL-SourceSans3.md",
  },
] as const;

describe("self-hosted student fonts", () => {
  it.each(APPROVED)(
    "$family: the approved bytes, with the OFL text beside them",
    (f) => {
      const bytes = readFileSync(path.join(FONT_DIR, f.file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(f.sha256);
      const licence = path.join(FONT_DIR, f.licence);
      expect(existsSync(licence)).toBe(true);
      expect(readFileSync(licence, "utf8")).toMatch(
        /SIL Open Font License, Version 1\.1/,
      );
    },
  );

  it.each(APPROVED)(
    "$family: declared by @font-face from the app's own origin",
    (f) => {
      const face = TOKENS.split("@font-face").find((b) =>
        b.includes(`"${f.family}"`),
      );
      expect(face, `no @font-face for ${f.family}`).toBeDefined();
      expect(face).toContain(`url("/fonts/${f.file}") format("woff2")`);
      expect(face).toMatch(/font-display:\s*swap/);
    },
  );

  it("nothing in the token layer loads a font from another origin", () => {
    expect(TOKENS).not.toMatch(/url\(\s*["']?https?:/);
  });
});
