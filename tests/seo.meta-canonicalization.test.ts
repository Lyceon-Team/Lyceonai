import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("SEO canonicalization ownership", () => {
  it("removes client JSON-LD and relies on SSR injection", () => {
    const indexHtml = readFile("client/index.html");
    expect(indexHtml).not.toMatch(/application\/ld\+json/);
  });

  it("routes SSR metadata through shared sources and server injection", () => {
    const seoContent = readFile("server/seo-content.ts");
    expect(seoContent).toMatch(/PUBLIC_META/);
    expect(seoContent).toMatch(/requirePublicMeta/);

    const serverIndex = readFile("server/index.ts");
    expect(serverIndex).toMatch(/injectJsonLd/);
    expect(serverIndex).toMatch(/PUBLIC_META/);
  });
});
