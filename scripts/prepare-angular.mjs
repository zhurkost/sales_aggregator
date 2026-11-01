import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import "./package-extension.mjs";
// Node 22 on Windows can abort in recursive cpSync on an existing asset directory.
// Copy the authored tree explicitly so repeat builds and dev startup remain usable.
function copyAssets(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyAssets(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
    else throw new Error(`Unsupported asset entry: ${from}`);
  }
}
copyAssets("public", "frontend/public");
