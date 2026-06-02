import "dotenv/config";
import express from "express";
import cors from "cors";
import { pipeline, env as hfEnv } from "@huggingface/transformers";
import { createClient } from "@supabase/supabase-js";

const PORT = Number(process.env.PORT) || 8788;
const MODEL = process.env.EMBEDDING_MODEL || "Supabase/gte-small";
const DIM = Number(process.env.EMBEDDING_DIM) || 384;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

hfEnv.allowLocalModels = false;

let extractor = null;
let warm = false;

async function getExtractor() {
  if (!extractor) extractor = await pipeline("feature-extraction", MODEL);
  return extractor;
}

async function embed(texts) {
  const ex = await getExtractor();
  const out = await ex(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

const app = express();
const origins = process.env.ALLOWED_ORIGINS;
app.use(cors({ origin: origins && origins !== "*" ? origins.split(",").map((s) => s.trim()) : true }));
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, dim: DIM, warm, supabase: Boolean(supabase) });
});

app.post("/embed", async (req, res) => {
  try {
    const texts = Array.isArray(req.body?.texts)
      ? req.body.texts
      : typeof req.body?.text === "string"
        ? [req.body.text]
        : null;
    if (!texts?.length) return res.status(400).json({ error: "Provide { texts } or { text }" });

    const embeddings = await embed(texts);
    res.json({ model: MODEL, dim: embeddings[0]?.length ?? DIM, embeddings });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/search", async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

    const q = String(req.body?.q || "").trim();
    const limit = Math.min(Math.max(Number(req.body?.limit) || 100, 1), 100);
    const threshold = Number.isFinite(Number(req.body?.threshold)) ? Number(req.body.threshold) : 0;
    if (q.length < 2) return res.json({ query: q, matches: [] });

    const [vector] = await embed([q]);
    const { data, error } = await supabase.rpc("match_sponsor_markets", {
      query_embedding: `[${vector.join(",")}]`,
      match_threshold: threshold,
      match_count: limit,
    });
    if (error) throw new Error(error.message);

    res.json({ query: q, matches: data ?? [] });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.listen(PORT, async () => {
  console.log(`sponsor-poll server :${PORT} - model ${MODEL} (${DIM}d), supabase ${supabase ? "ok" : "OFF"}`);
  try {
    await embed(["warmup"]);
    warm = true;
    console.log("embedding model warm");
  } catch (error) {
    console.error("embedding warmup failed:", error?.message || error);
  }
});
