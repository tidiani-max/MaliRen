#!/usr/bin/env node
// Creates .env from .env.example with freshly generated secrets. Works on macOS, Windows and Linux (Node ≥ 18).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, ".env");
if (existsSync(target) && !process.argv.includes("--force")) {
  console.log(
    ".env already exists  left untouched (use --force to regenerate; this changes secrets and logs everyone out).",
  );
  process.exit(0);
}
copyFileSync(join(root, ".env.example"), target);
let text = readFileSync(target, "utf8");
text = text.replace(
  /^POSTGRES_PASSWORD=.*$/m,
  `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`,
);
text = text.replace(
  /^JWT_SECRET=.*$/m,
  `JWT_SECRET=${randomBytes(48).toString("hex")}`,
);
writeFileSync(target, text);
console.log(
  "✔ .env created with random POSTGRES_PASSWORD and JWT_SECRET.\n  Next: docker compose up --build",
);
