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

type EmbeddingItem = {
  id: string;
  market_id: string;
  prospect_id: string | null;
  prospect_name: string | null;
  content_type: "market" | "prospect";
  name: string;
  region_type: SponsorMarket["region_type"];
  country: string;
  region: string;
  priority: SponsorMarket["priority"];
  prospect_count: number;
  contact_count: number;
  content: string;
};

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
  ]
    .map(clean)
    .filter(Boolean)
    .join("\n");
}

function embeddingItems(market: SponsorMarket): EmbeddingItem[] {
  const marketContent = marketText(market);
  const prospectCount = market.prospects?.length || 0;
  const marketContactCount = (market.prospects || []).reduce((sum, prospect) => sum + (prospect.contacts?.length || 0), 0);

  if (!market.prospects?.length) {
    return [
      {
        id: `${market.id}#market`,
        market_id: market.id,
        prospect_id: null,
        prospect_name: null,
        content_type: "market",
        name: market.name,
        region_type: market.region_type,
        country: market.country,
        region: market.region,
        priority: market.priority,
        prospect_count: prospectCount,
        contact_count: marketContactCount,
        content: marketContent,
      },
    ];
  }

  return market.prospects.map((prospect) => ({
    id: `${market.id}#${prospect.id || prospect.name}`,
    market_id: market.id,
    prospect_id: prospect.id,
    prospect_name: prospect.name,
    content_type: "prospect",
    name: market.name,
    region_type: market.region_type,
    country: market.country,
    region: market.region,
    priority: market.priority,
    prospect_count: 1,
    contact_count: prospect.contacts?.length || 0,
    content: `${marketContent}\n${prospectText(prospect)}`,
  }));
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
  const items = markets.flatMap(embeddingItems);
  let indexed = 0;

  for (let i = 0; i < items.length; i += 24) {
    const batch = items.slice(i, i + 24);
    const texts = batch.map((item) => item.content);
    const vectors = await embedBatch(texts);
    const rows = batch.map((item, index) => ({
      ...item,
      embedding: `[${vectors[index].join(",")}]`,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from("sponsor_embeddings").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(error.message);
    indexed += rows.length;
    console.log(`Indexed ${indexed}/${items.length} sponsor lead records`);
  }

  console.log(`Done. Indexed ${indexed} sponsor lead records into Supabase vector search.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
