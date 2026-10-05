/**
 * @spec [LYCEON legal versioning Phase 2 §1, §4; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: makes `legal/` reachable by the browser without ever creating
 * a second editable copy of a document body. In dev it serves the directory
 * straight off disk; at build it copies the directory into the Vite output,
 * where Vercel's filesystem handler serves it.
 *
 * expected outcome: `GET /legal/<slug>/<version>/en.md` returns the exact bytes
 * of `legal/<slug>/<version>/en.md` in both modes, so the SHA-256 in meta.yml
 * describes what the browser actually received.
 *
 * WHY A COPY IS NOT A SECOND SOURCE. The Vercel function is a single esbuild
 * bundle and nothing traces `legal/**` into it, so a runtime `readFileSync` of
 * the repo path is ENOENT in production. What Phase 2 forbids is a second
 * EDITABLE copy or a fallback constant — text a person can change on its own,
 * or stale text shipped when the real file is missing. This is neither: it is
 * regenerated from the source on every build, it is gitignored, and
 * `legal-body-purity-gate.mjs` asserts the copied bytes hash-match the source.
 * Owner ruling, 2026-09-15.
 *
 * trade-offs:
 *  - The output lands at `dist/public/legal/`, which shares a URL prefix with
 *    the page route `/legal/:slug`. Since F1 (2026-10-03) the prerender writes
 *    each document page as `dist/public/legal/<slug>/index.html`, into the same
 *    directory this plugin fills: Vercel's `filesystem` handler serves that
 *    index.html for `/legal/<slug>` and the deeper asset paths
 *    (`/legal/<slug>/<version>/en.md`, `manifest.json`, `index.json`) as files.
 *    The prerender runs after this copy, so neither overwrites the other.
 *  - Dev serving is a middleware rather than Vite's `publicDir`, because
 *    publicDir is a single directory rooted at `client/` and pointing it at
 *    `legal/` would mean committing the copy — the thing being avoided.
 *
 * edge cases:
 *  - Path traversal is refused: the resolved path must stay inside `legal/`.
 *  - An unknown path 404s. It never falls back to any other document's text.
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const URL_PREFIX = "/legal/";

const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

/**
 * The slug list the hub enumerates from.
 *
 * `legal/` is served as static files, and static hosting has no directory
 * listing — so the one thing a client cannot discover for itself is what
 * exists. This publishes exactly that, and nothing else: no title, no
 * description, no version. Those live in each manifest, and duplicating them
 * here would put document metadata in two files. `index.json` answers "which
 * documents are there", the manifests answer "what is this one".
 *
 * Derived and regenerated on every build, never committed. The body-purity
 * gate checks it against the directory, so it cannot drift from the truth.
 */
function buildIndex(sourceDir: string): string {
  const slugs = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) =>
      fs.existsSync(path.join(sourceDir, name, "manifest.json")),
    )
    .sort();
  return `${JSON.stringify({ slugs }, null, 2)}\n`;
}

export type LegalFile = { body: Buffer; contentType: string | undefined };

/**
 * What `GET /legal/<relative>` answers, read from `legal/`: the file, `"forbidden"` for a path
 * that escapes the directory, or null for anything that is not a file. `index.json` is
 * synthesized from the directory, exactly as the build writes it.
 *
 * The ONE implementation of that answer: the dev middleware serves it, and the build-time
 * prerender (`legalFetch` below) loads legal pages through it, so the static HTML is built
 * from the same bytes `legal-body-purity-gate.mjs` proves the deployment ships.
 */
export function readLegalFile(
  sourceDir: string,
  relative: string,
): LegalFile | "forbidden" | null {
  if (relative === "index.json") {
    return {
      body: Buffer.from(buildIndex(sourceDir)),
      contentType: CONTENT_TYPES[".json"],
    };
  }
  const resolved = path.resolve(sourceDir, relative);
  // Refuse anything that escapes legal/, and anything that is not a file.
  if (resolved !== sourceDir && !resolved.startsWith(sourceDir + path.sep)) {
    return "forbidden";
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return {
    body: fs.readFileSync(resolved),
    contentType: CONTENT_TYPES[path.extname(resolved)],
  };
}

/**
 * A `fetch` for the build-time prerender (F1). The legal pages load their content with
 * `fetch("/legal/...")`; in Node there is no origin to resolve that against, so the
 * prerender answers those requests from `legal/` through `readLegalFile`. Any other URL is
 * refused, loudly: a page that fetches anything else at prerender time is a page whose static
 * HTML would depend on a network the build does not have.
 */
export function legalFetch(sourceDir: string): typeof fetch {
  return async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : input.url;
    if (!url.startsWith(URL_PREFIX)) {
      throw new Error(`prerender: unexpected fetch of ${url}`);
    }
    const file = readLegalFile(
      sourceDir,
      decodeURIComponent(url.slice(URL_PREFIX.length)),
    );
    if (file === "forbidden") return new Response("Forbidden", { status: 403 });
    if (file === null) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: file.contentType ? { "Content-Type": file.contentType } : {},
    });
  };
}

export function legalContentPlugin(repoRoot: string): Plugin {
  const sourceDir = path.resolve(repoRoot, "legal");
  let ssrBuild = false;

  return {
    name: "lyceon-legal-content",

    configResolved(config) {
      ssrBuild = Boolean(config.build.ssr);
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith(URL_PREFIX)) return next();

        const file = readLegalFile(
          sourceDir,
          decodeURIComponent(url.slice(URL_PREFIX.length)),
        );
        if (file === "forbidden") {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (file === null) return next();
        if (file.contentType) res.setHeader("Content-Type", file.contentType);
        res.end(file.body);
      });
    },

    closeBundle() {
      // Only the client build produces the static output this belongs in. The prerender's
      // SSR build (F1) writes to dist/prerender and must not re-copy over dist/public.
      if (ssrBuild) return;
      if (!fs.existsSync(sourceDir)) return;
      const outDir = path.resolve(repoRoot, "dist/public/legal");

      // Copy INTO the directory, never over it.
      //
      // This was additive because `client/public/legal/` shipped six PDFs at
      // this exact path, which Vite's publicDir copy had already placed here by
      // the time this ran; an `rm -rf` of the target would have deleted every
      // "Download PDF" link on the legal pages. Those PDFs are now deleted, and
      // `client/public/legal/` no longer exists, so this plugin is the only
      // writer of `dist/public/legal` and the directory is wholly owned by the
      // build.
      //
      // It stays additive anyway. `build.emptyOutDir` already clears
      // `dist/public` at the start of every build, so a destructive copy would
      // buy nothing Vite has not done — while giving this code the power to
      // delete something it did not create. Keeping the weaker power is free.
      fs.mkdirSync(outDir, { recursive: true });
      for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const from = path.join(sourceDir, entry.name);
        const to = path.join(outDir, entry.name);
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(from, to, { recursive: true });
      }

      fs.writeFileSync(path.join(outDir, "index.json"), buildIndex(sourceDir));
    },
  };
}
