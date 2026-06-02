import "./load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  throw new Error("SUPABASE_DB_URL is required. Add it to client/.env.local or paste client/supabase/schema.sql in Supabase SQL editor.");
}

const requiredDbUrl = dbUrl;

async function main() {
  const sql = postgres(requiredDbUrl, { max: 1, ssl: "require" });

  try {
    const schema = readFileSync(path.join(process.cwd(), "supabase", "schema.sql"), "utf8");
    await sql.unsafe(schema);
    console.log("Supabase sponsor schema is ready.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
