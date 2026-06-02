import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const candidates = [
  path.join(process.cwd(), ".env.local"),
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", "server", ".env"),
];

for (const file of candidates) {
  if (existsSync(file)) config({ path: file, override: false });
}
