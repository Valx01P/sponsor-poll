const BASE =
  process.env.NEXT_PUBLIC_GTE_SERVER_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8788" : "");

export type SponsorSemanticMatch = {
  id: string;
  name: string;
  region_type: string;
  country: string;
  region: string;
  prospect_count: number;
  contact_count: number;
  similarity: number;
};

export async function semanticSearch(q: string, limit = 100): Promise<SponsorSemanticMatch[]> {
  if (!BASE) throw new Error("NEXT_PUBLIC_GTE_SERVER_URL is not set");
  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, limit, threshold: 0 }),
  });
  if (!res.ok) throw new Error(`sponsor server ${res.status}`);
  const json = await res.json();
  return json.matches || [];
}
