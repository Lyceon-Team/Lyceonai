import { promises as fs } from "node:fs";
import path from "node:path";

const targetDirs = ["dist", "public", path.join("client", "dist")];
const needle = "cdn.jsdelivr.net/npm/katex";

const matches = [];

const walk = async (dir) => {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        return;
      }
      if (!entry.isFile()) {
        return;
      }

      let contents;
      try {
        contents = await fs.readFile(fullPath, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") {
          return;
        }
        throw error;
      }

      if (contents.includes(needle)) {
        matches.push(fullPath);
      }
    })
  );
};

for (const dir of targetDirs) {
  await walk(dir);
}

if (matches.length > 0) {
  console.error("FOUND CDN KATEX - FAIL");
  for (const match of matches) {
    console.error(`- ${match}`);
  }
  process.exit(1);
}
