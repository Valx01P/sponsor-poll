const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "job", "sponsors.json");
const REGION_DIR = path.join(ROOT, "job", "regions");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hasContactMethod(contact) {
  return Boolean(contact.email || contact.linkedin_url || contact.contact_url || contact.phone);
}

function summarizeMarket(market) {
  const prospects = market.prospects || [];
  const contacts = prospects.flatMap((prospect) => prospect.contacts || []);
  const missingContactMethods = contacts.filter((contact) => !hasContactMethod(contact)).length;
  const duplicateContacts = contacts.length - new Set(contacts.map((contact) => `${contact.email || ""}|${contact.linkedin_url || ""}|${contact.name || ""}|${contact.title || ""}`.toLowerCase())).size;
  return { prospects: prospects.length, contacts: contacts.length, missingContactMethods, duplicateContacts };
}

function validate() {
  const data = readJson(DATA);
  const totals = { markets: 0, prospects: 0, contacts: 0, missingContactMethods: 0, duplicateContacts: 0 };

  for (const market of data.markets || []) {
    const summary = summarizeMarket(market);
    totals.markets++;
    totals.prospects += summary.prospects;
    totals.contacts += summary.contacts;
    totals.missingContactMethods += summary.missingContactMethods;
    totals.duplicateContacts += summary.duplicateContacts;
  }

  const partitionCount = fs.existsSync(REGION_DIR)
    ? fs.readdirSync(REGION_DIR).filter((file) => /^sponsor-.*\.json$/.test(file)).length
    : 0;

  console.log(`Sponsor data: ${totals.markets} markets | ${totals.prospects} prospects | ${totals.contacts} contacts`);
  console.log(`Partitions: ${partitionCount}`);
  console.log(`Contacts missing direct method: ${totals.missingContactMethods}`);
  console.log(`Likely duplicate contacts after merge: ${totals.duplicateContacts}`);
}

if (require.main === module) validate();

module.exports = { validate };
