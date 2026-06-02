import "./load-env";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) throw new Error("Supabase URL and server key are required.");

const supabaseUrl = url;
const supabaseKey = key;

async function main() {
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.from("sponsor_embeddings").delete().not("id", "is", null);

  if (error) throw new Error(error.message);
  console.log("Cleared sponsor embeddings.");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
