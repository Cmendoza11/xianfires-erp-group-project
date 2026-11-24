import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localEnv = path.join(__dirname, ".env");
const rootEnv = path.resolve(__dirname, "../../.env");

if (typeof process.loadEnvFile === "function") {
  if (fs.existsSync(localEnv)) {
    try {
      process.loadEnvFile(localEnv);
    } catch {}
  } else if (fs.existsSync(rootEnv)) {
    try {
      process.loadEnvFile(rootEnv);
    } catch {}
  }
}
