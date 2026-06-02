const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE = path.join(ROOT, "job", "sponsors.json");
const OUT_DIR = path.join(ROOT, "job", "regions");

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function buildRegionPartitions() {
  const data = readJson(SOURCE);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const market of data.markets || []) {
    const file = path.join(OUT_DIR, `sponsor-${slug(market.id)}.json`);
    writeJson(file, {
      meta: {
        generated_at: new Date().toISOString(),
        source: "job/sponsors.json",
        market_id: market.id,
        instructions: "Edit market.prospects only for this market, keep valid JSON, and do not remove existing high-confidence leads.",
      },
      market,
    });
  }

  console.log(`Wrote ${(data.markets || []).length} sponsor region partitions to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) buildRegionPartitions();

module.exports = { buildRegionPartitions };
