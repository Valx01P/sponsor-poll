const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CANONICAL = path.join(ROOT, "job", "sponsors.json");
const CLIENT_COPY = path.join(ROOT, "client", "data", "sponsors.json");
const REGION_DIR = path.join(ROOT, "job", "regions");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function clean(value) {
  return String(value || "").trim();
}

function slug(value) {
  return clean(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeUrl(value) {
  return clean(value).replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/g, "").toLowerCase();
}

function richer(current, incoming) {
  if (!clean(current)) return incoming;
  if (!clean(incoming)) return current;
  return clean(incoming).length > clean(current).length ? incoming : current;
}

function mergeScalars(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (Array.isArray(value) || (value && typeof value === "object")) continue;
    target[key] = richer(target[key], value);
  }
  return target;
}

function contactKey(contact) {
  if (clean(contact.email)) return `email:${clean(contact.email).toLowerCase()}`;
  if (clean(contact.linkedin_url)) return `linkedin:${normalizeUrl(contact.linkedin_url)}`;
  if (clean(contact.contact_url)) return `url:${normalizeUrl(contact.contact_url)}`;
  return `name:${slug(`${contact.name || ""}-${contact.title || ""}-${contact.location || ""}`)}`;
}

function prospectKey(prospect) {
  if (clean(prospect.id)) return `id:${slug(prospect.id)}`;
  if (clean(prospect.website_url)) return `site:${normalizeUrl(prospect.website_url)}`;
  return `name:${slug(`${prospect.name || ""}-${prospect.prospect_type || ""}-${prospect.location || ""}`)}`;
}

function mergeContacts(a = [], b = []) {
  const map = new Map();
  for (const contact of [...a, ...b]) {
    if (!contact || !clean(contact.name)) continue;
    const key = contactKey(contact);
    const existing = map.get(key) || {};
    map.set(key, mergeScalars({ ...existing }, contact));
  }
  return [...map.values()].sort((left, right) => clean(left.name).localeCompare(clean(right.name)));
}

function mergeProspects(a = [], b = []) {
  const map = new Map();
  for (const prospect of [...a, ...b]) {
    if (!prospect || !clean(prospect.name)) continue;
    const key = prospectKey(prospect);
    const existing = map.get(key) || {};
    const next = mergeScalars({ ...existing }, prospect);
    next.id = clean(next.id) || slug(`${next.name}-${next.prospect_type || "sponsor"}`);
    next.contacts = mergeContacts(existing.contacts, prospect.contacts);
    map.set(key, next);
  }
  return [...map.values()].sort((left, right) => clean(left.name).localeCompare(clean(right.name)));
}

function mergeMarkets(base, incoming) {
  const market = mergeScalars({ ...base }, incoming);
  market.poll_topics = [...new Set([...(base.poll_topics || []), ...(incoming.poll_topics || [])].map(clean).filter(Boolean))];
  market.prospects = mergeProspects(base.prospects, incoming.prospects);
  return market;
}

function recomputeMeta(data) {
  const markets = data.markets || [];
  const totalProspects = markets.reduce((sum, market) => sum + (market.prospects?.length || 0), 0);
  const totalContacts = markets.reduce(
    (sum, market) => sum + (market.prospects || []).reduce((inner, prospect) => inner + (prospect.contacts?.length || 0), 0),
    0,
  );
  data.meta = {
    ...(data.meta || {}),
    version: data.meta?.version || "1.0.0",
    last_updated: new Date().toISOString().slice(0, 10),
    total_markets: markets.length,
    total_prospects: totalProspects,
    total_contacts: totalContacts,
  };
  return data;
}

function partitionFiles() {
  if (!fs.existsSync(REGION_DIR)) return [];
  return fs.readdirSync(REGION_DIR)
    .filter((file) => /^sponsor-.*\.json$/.test(file))
    .map((file) => path.join(REGION_DIR, file));
}

function mergeSponsorPartitions() {
  const canonical = readJson(CANONICAL);
  const order = (canonical.markets || []).map((market) => market.id);
  const byId = new Map((canonical.markets || []).map((market) => [market.id, market]));

  for (const file of partitionFiles()) {
    const partition = readJson(file);
    const market = partition.market || partition;
    if (!market?.id) continue;
    const existing = byId.get(market.id) || {};
    byId.set(market.id, mergeMarkets(existing, market));
    if (!order.includes(market.id)) order.push(market.id);
  }

  const merged = recomputeMeta({
    ...canonical,
    markets: order.map((id) => byId.get(id)).filter(Boolean),
  });

  writeJson(CANONICAL, merged);
  writeJson(CLIENT_COPY, merged);

  console.log(`Merged ${partitionFiles().length} partitions.`);
  console.log(`${merged.meta.total_markets} markets | ${merged.meta.total_prospects} prospects | ${merged.meta.total_contacts} contacts`);
  return merged;
}

if (require.main === module) mergeSponsorPartitions();

module.exports = { mergeSponsorPartitions };
