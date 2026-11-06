import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const reference = "data/rental";
for (const file of [
  "backend/target/autopost-api.jar",
  "dist-angular/browser/index.html",
  reference + "/categories.json",
])
  if (!existsSync(file))
    throw new Error(`Build missing: ${file}. Run npm run build first.`);
mkdirSync("work", { recursive: true });
const java = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
  : "java";
execFileSync(java, ["-jar", "backend/target/autopost-api.jar", "--validate-categories=" + reference], {
  stdio: "inherit", windowsHide: true,
});
execFileSync(
  "tar",
  [
    "-czf",
    "work/autopost-angular-spring.tar.gz",
    "backend/target/autopost-api.jar",
    "dist-angular/browser",
    "dist-angular/3rdpartylicenses.txt",
    "deploy/spring",
    reference,
  ],
  { stdio: "inherit", windowsHide: true },
);
console.log("Release: work/autopost-angular-spring.tar.gz");
