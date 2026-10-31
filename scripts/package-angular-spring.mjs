import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
for (const file of [
  "backend/target/autopost-api.jar",
  "dist-angular/browser/index.html",
])
  if (!existsSync(file))
    throw new Error(`Build missing: ${file}. Run npm run build first.`);
mkdirSync("work", { recursive: true });
execFileSync(
  "tar",
  [
    "-czf",
    "work/autopost-angular-spring.tar.gz",
    "backend/target/autopost-api.jar",
    "dist-angular/browser",
    "dist-angular/3rdpartylicenses.txt",
    "deploy/spring",
    "vps/backup-workspace.py",
  ],
  { stdio: "inherit", windowsHide: true },
);
console.log("Release: work/autopost-angular-spring.tar.gz");
