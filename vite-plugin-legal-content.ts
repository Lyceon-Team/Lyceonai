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
 *    the SPA route `/legal/:slug`. They do not collide: Vercel's `filesystem`
 *    handler matches real files, and `/legal/privacy-policy` is a directory
 *    with no index.html, so it falls through to the SPA as before. Only the
 *    deeper asset paths resolve to files.
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

export function legalContentPlugin(repoRoot: string): Plugin {
  const sourceDir = path.resolve(repoRoot, "legal");

  return {
    name: "lyceon-legal-content",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith(URL_PREFIX)) return next();

        const relative = decodeURIComponent(url.slice(URL_PREFIX.length));
        const resolved = path.resolve(sourceDir, relative);

        // Refuse anything that escapes legal/, and anything that is not a file.
        if (
          resolved !== sourceDir &&
          !resolved.startsWith(sourceDir + path.sep)
        ) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
          return next();
        }

        const type = CONTENT_TYPES[path.extname(resolved)];
        if (type) res.setHeader("Content-Type", type);
        res.end(fs.readFileSync(resolved));
      });
    },

    closeBundle() {
      // Only the client build produces the static output this belongs in.
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
    },
  };
}
