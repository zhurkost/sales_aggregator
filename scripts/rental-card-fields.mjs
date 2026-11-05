// Writes the card field IDs the editor needs from the one place the server keeps them:
// rental/model/CardFields.java. `--check` only compares (tests and CI).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = "backend/src/main/java/by/autopost/rental/model/CardFields.java";
const target = "frontend/src/app/rental/card-fields.generated.ts";

export function generated() {
  const java = readFileSync(root + source, "utf8");
  const constants = [...java.matchAll(/public static final String (\w+) = ("[^"\\]*");/g)];
  if (!constants.length) throw new Error(`${source}: no card field constants`);
  return (
    `// Generated from ${source} by scripts/rental-card-fields.mjs. Do not edit.\n` +
    constants.map(([, name, value]) => `export const ${name} = ${value};\n`).join("")
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = generated();
  if (process.argv.includes("--check")) {
    if (readFileSync(root + target, "utf8") !== text) {
      console.error(`${target} is out of date: run node scripts/rental-card-fields.mjs`);
      process.exit(1);
    }
  } else writeFileSync(root + target, text);
}
