import fs from "fs";
import path from "path";

const root = process.cwd();
const targets = ["dist", path.join("client", "dist"), path.join("apps", "api", "dist")];

for (const rel of targets) {
  fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  console.log(`removed ${rel}`);
}
