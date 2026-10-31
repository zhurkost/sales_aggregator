import { cpSync, mkdirSync } from "node:fs";
import "./package-extension.mjs";
mkdirSync("frontend/public", { recursive: true });
cpSync("public", "frontend/public", { recursive: true });
