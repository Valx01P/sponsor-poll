import "./load-env";
import { createClient } from "@supabase/supabase-js";
import data from "../data/sponsors.json";
import type { SponsorMarket, SponsorProspect } from "../lib/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const embedUrl = process.env.NEXT_PUBLIC_GTE_SERVER_URL || "http://localhost:8788";

if (!url || !key) throw new Error("Supabase URL and server key are required.");

const supabaseUrl = url;
const supabaseKey = key;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function prospectText(prospect: SponsorProspect) {
  const pieces = [
    prospect.name,
    prospect.prospect_type,
    prospect.description,
    prospect.location,
    prospect.political_leaning,
    prospect.sponsor_fit,
    prospect.sponsorship_history,
    prospect.prior_poll_sponsorship,
    prospect.estimated_budget,
    prospect.notes,
    prospect.website_url,
    prospect.contact_url,
  ];

  for (const contact of prospect.contacts || []) {
    pieces.push(contact.name, contact.title, contact.email, contact.location, contact.political_leaning, contact.notes, contact.linkedin_url, contact.contact_url);
  }

  return pieces.map(clean).filter(Boolean).join(" | ");
}

function marketText(market: SponsorMarket) {
  return [
    market.name,
    market.region_type,
    market.country,
    market.region,
    `priority ${market.priority}`,
    market.description,
    market.prospect_notes,
    ...(market.poll_topics || []),
    ...(market.prospects || []).map(prospectText),
  ]
    .map(clean)
    .filter(Boolean)
    .join("\n");
}

async function embedBatch(texts: string[]) {
  const res = await fetch(`${embedUrl}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`Embed server returned ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.embeddings as number[][];
}

async function main() {
  const markets = data.markets as SponsorMarket[];
  let indexed = 0;

  for (let i = 0; i < markets.length; i += 12) {
    const batch = markets.slice(i, i + 12);
    const texts = batch.map(marketText);
    const vectors = await embedBatch(texts);
    const rows = batch.map((market, index) => {
      const prospectCount = market.prospects?.length || 0;
      const contactCount = (market.prospects || []).reduce((sum, prospect) => sum + (prospect.contacts?.length || 0), 0);

      return {
        id: market.id,
        name: market.name,
        region_type: market.region_type,
        country: market.country,
        region: market.region,
        priority: market.priority,
        prospect_count: prospectCount,
        contact_count: contactCount,
        content: texts[index],
        embedding: `[${vectors[index].join(",")}]`,
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase.from("sponsor_embeddings").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(error.message);
    indexed += rows.length;
    console.log(`Indexed ${indexed}/${markets.length} sponsor markets`);
  }

  console.log(`Done. Indexed ${indexed} sponsor markets into Supabase vector search.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
