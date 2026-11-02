import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import "./prepare-angular.mjs";
// Use the existing extension origin and local database, without exposing listeners on the LAN.
const local = existsSync(".dev.vars")
  ? parseEnv(readFileSync(".dev.vars", "utf8"))
  : {};
const environment = {
  ...local,
  ...process.env,
  PUBLIC_ORIGIN: "http://127.0.0.1:5173",
  DATA_DIR: fileURLToPath(new URL("../work/local-data", import.meta.url)),
  VPS_PROXY_SECRET: "",
  RENTAL_REFERENCE_DIR: process.env.RENTAL_REFERENCE_DIR || local.RENTAL_REFERENCE_DIR ||
    fileURLToPath(new URL("../data/rental/apartments_long_term_rent", import.meta.url)),
};
const api = spawn(process.execPath, ["scripts/maven.mjs", "spring-boot:run"], {
  stdio: "inherit",
  env: environment,
  windowsHide: true,
});
const frontend = spawn(
  process.execPath,
  [
    "node_modules/@angular/cli/bin/ng.js",
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--proxy-config",
    "proxy.conf.json",
  ],
  { cwd: "frontend", stdio: "inherit", env: environment, windowsHide: true },
);
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  api.kill();
  frontend.kill();
  process.exitCode = code;
}
api.on("error", (error) => {
  console.error(error.message);
  close(1);
});
frontend.on("error", (error) => {
  console.error(error.message);
  close(1);
});
api.on("exit", (code) => close(code || 0));
frontend.on("exit", (code) => close(code || 0));
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
