import fs from "fs";
import path from "path";

const ROOTS = ["dist", "public", "client/dist"];
const TARGET = "cdn.jsdelivr.net/npm/katex";

/**
 * Recursively walks the given directory and returns a flat list of file paths.
 *
 * If the directory does not exist, an empty array is returned.
 *
 * @param {string} dir - The root directory to traverse.
 * @returns {string[]} An array of absolute (or joined) file paths found under the directory.
 */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

let found = false;

for (const root of ROOTS) {
  const files = walk(root);
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes(TARGET)) {
        console.error(`FOUND CDN KATEX IN: ${file}`);
        found = true;
      }
    } catch (err) {
      console.error(`WARNING: Failed to read file "${file}": ${err && err.message ? err.message : err}`);
    }
  }
}

if (found) {
  console.error("FOUND CDN KATEX - FAIL");
  process.exit(1);
}

console.log("✓ No external KaTeX CDN references found.");
