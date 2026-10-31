import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const wrapper = path.join(
  root,
  "backend",
  process.platform === "win32" ? "mvnw.cmd" : "mvnw",
);
const result = spawnSync(wrapper, args, {
  cwd: path.join(root, "backend"),
  stdio: "inherit",
  shell: process.platform === "win32",
  windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
