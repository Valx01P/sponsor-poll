const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "job", "sponsors.json");
const OUT_DIR = path.join(ROOT, "job", "swarm", "region-instructions");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function instructionFor(market) {
  return `# Sponsor Poll Region: ${market.name}

Partition file: \`job/regions/sponsor-${slug(market.id)}.json\`

## Goal

Find high-confidence people or organizations that may sponsor public opinion polling in this market.

## What To Add

- Chambers of commerce, trade groups, civic organizations, ballot measure committees, PACs, advocacy groups, media outlets, campaigns, donors, universities, businesses, and public affairs firms.
- Contacts with email, LinkedIn, contact form, phone, or another direct outreach path.
- Useful context: political leaning when knowable, prior poll sponsorship, likely budget level, issue interests, location, website, and notes with source-aware wording.

## Rules

- Keep valid JSON.
- Edit only this market partition.
- Preserve existing prospects and contacts unless you are merging exact duplicates.
- Prefer adding fewer verified leads over many weak guesses.
- If a stop marker exists at \`job/swarm/sponsor-region-stop.json\`, finish the current research batch, write the JSON, and exit.
`;
}

function generateRegionInstructions() {
  const data = readJson(DATA);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const market of data.markets || []) {
    fs.writeFileSync(path.join(OUT_DIR, `${slug(market.id)}.md`), instructionFor(market));
  }
  console.log(`Wrote ${(data.markets || []).length} region instructions to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) generateRegionInstructions();

module.exports = { generateRegionInstructions };
