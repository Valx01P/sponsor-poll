#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { buildRegionPartitions } = require("./build-region-partitions");
const { generateRegionInstructions } = require("./generate-region-instructions");
const { mergeSponsorPartitions } = require("./merge-sponsor-partitions");

const ROOT = path.resolve(__dirname, "..", "..");
const REGION_DIR = path.join(ROOT, "job", "regions");
const STATE_FILE = path.join(ROOT, "job", "swarm", "sponsor-region-state.json");
const STOP_FILE = path.join(ROOT, "job", "swarm", "sponsor-region-stop.json");
const LOG_DIR = path.join(ROOT, "job", "swarm", "sponsor-region-logs");
const DEFAULT_MAX_ACTIVE = 24;
const DEFAULT_HOURLY_AGENT_COST = Number(process.env.SPONSOR_SWARM_HOURLY_AGENT_COST || 3);

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "force" || key === "no-merge") {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i++;
  }
  return args;
}

function pidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      version: 1,
      startedAt: nowIso(),
      maxActive: DEFAULT_MAX_ACTIVE,
      hourlyAgentCost: DEFAULT_HOURLY_AGENT_COST,
      batchesByMarket: {},
      active: {},
      finished: [],
      selectedMarkets: null,
    };
  }
  return readJson(STATE_FILE);
}

function saveState(state) {
  writeJson(STATE_FILE, state);
}

function refreshState(state) {
  for (const [key, worker] of Object.entries({ ...(state.active || {}) })) {
    if (pidAlive(worker.pid)) continue;
    const endedAt = nowIso();
    const durationMs = Date.parse(endedAt) - Date.parse(worker.startedAt);
    state.finished = state.finished || [];
    state.finished.push({ ...worker, endedAt, durationMs });
    delete state.active[key];
  }
  saveState(state);
  return state;
}

function regionFiles() {
  if (!fs.existsSync(REGION_DIR)) buildRegionPartitions();
  return fs.readdirSync(REGION_DIR)
    .filter((file) => /^sponsor-.*\.json$/.test(file))
    .map((file) => path.join(REGION_DIR, file))
    .sort();
}

function loadRegions() {
  return regionFiles().map((file) => {
    const partition = readJson(file);
    return { file, market: partition.market || partition };
  });
}

function hasContactMethod(contact) {
  return Boolean(contact.email || contact.linkedin_url || contact.contact_url || contact.phone);
}

function metrics(market) {
  const prospects = market.prospects || [];
  const contacts = prospects.flatMap((prospect) => prospect.contacts || []);
  const missingContactMethods = contacts.filter((contact) => !hasContactMethod(contact)).length;
  const prospectsWithoutContacts = prospects.filter((prospect) => !(prospect.contacts || []).length).length;
  const target = market.priority === 1 ? 15 : market.priority === 2 ? 10 : 6;
  const underTarget = Math.max(0, target - prospects.length);
  return {
    prospects: prospects.length,
    contacts: contacts.length,
    missingContactMethods,
    prospectsWithoutContacts,
    underTarget,
    target,
    empty: prospects.length === 0,
  };
}

function needKind(summary) {
  if (summary.empty) return "empty";
  if (summary.missingContactMethods || summary.prospectsWithoutContacts) return "contacts";
  if (summary.underTarget) return "underTarget";
  return "enrich";
}

function isAmericanMarket(market) {
  return market.country === "United States" || market.id === "US-DC" || String(market.id || "").startsWith("US-");
}

function needsWork(summary) {
  return summary.empty || summary.missingContactMethods > 0 || summary.prospectsWithoutContacts > 0 || summary.underTarget > 0;
}

function compareRegionWork(state, a, b) {
  const kindScore = { empty: 0, contacts: 1, underTarget: 2, enrich: 3 };
  const aBatches = state.batchesByMarket?.[a.market.id] || 0;
  const bBatches = state.batchesByMarket?.[b.market.id] || 0;
  if (aBatches !== bBatches) return aBatches - bBatches;
  const ak = kindScore[needKind(a.summary)];
  const bk = kindScore[needKind(b.summary)];
  if (ak !== bk) return ak - bk;
  if (isAmericanMarket(a.market) !== isAmericanMarket(b.market)) return isAmericanMarket(a.market) ? -1 : 1;
  if (a.market.priority !== b.market.priority) return a.market.priority - b.market.priority;
  return b.summary.underTarget - a.summary.underTarget || a.market.name.localeCompare(b.market.name);
}

function candidateRegions(state) {
  const activeIds = new Set(Object.values(state.active || {}).map((worker) => worker.marketId));
  const selected = state.selectedMarkets ? new Set(state.selectedMarkets) : null;
  return loadRegions()
    .filter(({ market }) => !activeIds.has(market.id))
    .filter(({ market }) => !selected || selected.has(market.id) || selected.has(slug(market.id)) || selected.has(slug(market.name)))
    .map((entry) => ({ ...entry, summary: metrics(entry.market) }))
    .filter((entry) => needsWork(entry.summary))
    .sort((a, b) => compareRegionWork(state, a, b));
}

function buildPrompt(market, file, batch) {
  const summary = metrics(market);
  return `You are a sponsor-poll research worker.

Read these project docs first:
- job/HUMAN_START.md
- job/SPONSOR_WORKFLOW.md

Update exactly one JSON partition:
- ${path.relative(ROOT, file)}

Market:
- ${market.name}
- ${market.region_type}, ${market.country}, ${market.region}
- priority ${market.priority}
- current prospects: ${summary.prospects}
- current contacts: ${summary.contacts}
- current batch: ${batch}
- next work type: ${needKind(summary)}

Goal:
Find people or organizations likely to sponsor Lester's public opinion polling in this market. Add or enrich prospects with direct outreach routes.

Required behavior:
- Preserve all existing useful prospects and contacts. Do not reduce the file.
- Fix duplicate contacts or prospects only when they are clearly the same entity.
- If a prospect has no usable outreach route, look for one before adding unrelated new prospects.
- Add high-confidence sponsors such as donors, PACs, advocacy groups, chambers, trade associations, media organizations, campaigns, civic groups, universities, public affairs firms, local businesses, and issue groups.
- Include political leaning only when it is reasonably inferable from public context.
- Include prior_poll_sponsorship, sponsorship_history, estimated_budget, sponsor_fit, website_url, contact_url, email, linkedin_url, phone, and notes when useful.
- Keep valid formatted JSON. The file shape must remain { "meta": ..., "market": ... }.
- If job/swarm/sponsor-region-stop.json exists, finish this current research batch, write the JSON, and exit.

Use web search where needed. When done, save the partition JSON and stop.`;
}

function launchWorker(state, region) {
  const marketId = region.market.id;
  const batch = (state.batchesByMarket[marketId] || 0) + 1;
  state.batchesByMarket[marketId] = batch;

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${slug(marketId)}-batch-${batch}-${Date.now()}.log`);
  const out = fs.openSync(logFile, "a");
  const prompt = buildPrompt(region.market, region.file, batch);
  const child = spawn("codex", ["--search", "-a", "never", "exec", "--json", "-C", ROOT, prompt], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  state.active[marketId] = {
    pid: child.pid,
    marketId,
    marketName: region.market.name,
    file: path.relative(ROOT, region.file),
    log: path.relative(ROOT, logFile),
    batch,
    startedAt: nowIso(),
  };
}

function launchAvailable(state) {
  if (fs.existsSync(STOP_FILE)) return 0;
  const maxActive = Number(state.maxActive || DEFAULT_MAX_ACTIVE);
  let launched = 0;
  while (Object.keys(state.active || {}).length < maxActive) {
    const [next] = candidateRegions(state);
    if (!next) break;
    launchWorker(state, next);
    launched++;
  }
  saveState(state);
  return launched;
}

function costSummary(state) {
  const hourly = Number(state.hourlyAgentCost || DEFAULT_HOURLY_AGENT_COST);
  const now = Date.now();
  const finishedMs = (state.finished || []).reduce((sum, worker) => sum + Number(worker.durationMs || 0), 0);
  const activeMs = Object.values(state.active || {}).reduce((sum, worker) => sum + Math.max(0, now - Date.parse(worker.startedAt)), 0);
  const agentHours = (finishedMs + activeMs) / 3600000;
  return { hourly, agentHours, estimatedCost: agentHours * hourly };
}

function printStatus(state) {
  state = refreshState(state);
  const regions = loadRegions().map((entry) => ({ ...entry, summary: metrics(entry.market) }));
  const totals = regions.reduce(
    (acc, region) => {
      acc.markets++;
      acc.prospects += region.summary.prospects;
      acc.contacts += region.summary.contacts;
      acc.missingContactMethods += region.summary.missingContactMethods;
      acc.underTarget += region.summary.underTarget;
      return acc;
    },
    { markets: 0, prospects: 0, contacts: 0, missingContactMethods: 0, underTarget: 0 },
  );

  console.log("\n=== Sponsor Poll Swarm Status ===\n");
  for (const region of regions.filter((entry) => needsWork(entry.summary)).sort((a, b) => compareRegionWork(state, a, b)).slice(0, 30)) {
    const active = state.active?.[region.market.id];
    const name = region.market.name.padEnd(22).slice(0, 22);
    const batchCount = state.batchesByMarket?.[region.market.id] || 0;
    console.log(
      `${name} p${region.market.priority} prospects:${String(region.summary.prospects).padStart(3)} contacts:${String(region.summary.contacts).padStart(3)} missing:${String(region.summary.missingContactMethods).padStart(3)} under:${String(region.summary.underTarget).padStart(3)} alive:${active ? "yes" : "no "} batches:${String(batchCount).padStart(3)} next:${needKind(region.summary)}`,
    );
  }

  const activeCount = Object.keys(state.active || {}).length;
  const costs = costSummary(state);
  console.log(`\nTotals: ${totals.markets} markets | ${totals.prospects} prospects | ${totals.contacts} contacts | ${totals.missingContactMethods} contacts missing outreach route | ${totals.underTarget} prospects under target`);
  console.log(`Workers: ${activeCount} active | ${(state.finished || []).length} finished batches | stop requested: ${fs.existsSync(STOP_FILE) ? "yes" : "no"}`);
  console.log(`Cost estimate: ${costs.agentHours.toFixed(2)} agent-hours * $${costs.hourly.toFixed(2)}/hr = $${costs.estimatedCost.toFixed(2)}`);
}

async function monitor(state) {
  while (true) {
    state = refreshState(state);
    const activeCount = Object.keys(state.active || {}).length;
    const launched = launchAvailable(state);
    const remaining = candidateRegions(state).length;

    if (activeCount === 0 && launched === 0) {
      if (!remaining || fs.existsSync(STOP_FILE)) break;
    }

    printStatus(state);
    await sleep(15000);
  }

  if (!fs.existsSync(STOP_FILE)) {
    console.log("No remaining sponsor work detected.");
  }
  mergeSponsorPartitions();
  printStatus(loadState());
}

async function stop(state, force, noMerge) {
  writeJson(STOP_FILE, { requested_at: nowIso(), force: Boolean(force) });
  state = refreshState(state);

  if (force) {
    for (const worker of Object.values(state.active || {})) {
      try {
        process.kill(worker.pid, "SIGTERM");
      } catch {}
    }
    await sleep(1500);
    state = refreshState(state);
  }

  while (Object.keys(state.active || {}).length) {
    const active = Object.values(state.active || {});
    console.log(`Stop requested. Waiting for ${active.length} active worker(s) to finish current batch...`);
    await sleep(10000);
    state = refreshState(state);
  }

  state.stoppedAt = nowIso();
  saveState(state);

  if (!noMerge) mergeSponsorPartitions();
  printStatus(state);
}

async function main() {
  const [command = "status", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  let state = loadState();

  if (args["max-active"]) state.maxActive = Math.max(1, Number(args["max-active"]));
  if (args["hourly-cost"]) state.hourlyAgentCost = Math.max(0, Number(args["hourly-cost"]));
  if (args._.length) state.selectedMarkets = args._.map(slug);

  if (command === "init") {
    if (Object.keys(refreshState(state).active || {}).length) {
      throw new Error("Workers are active. Stop them before rebuilding partitions.");
    }
    buildRegionPartitions();
    generateRegionInstructions();
    saveState({ ...state, startedAt: nowIso(), batchesByMarket: {}, active: {}, finished: [] });
    return;
  }

  if (command === "start") {
    if (fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
    buildRegionPartitions();
    generateRegionInstructions();
    state.startedAt = nowIso();
    launchAvailable(state);
    printStatus(state);
    return;
  }

  if (command === "monitor") {
    await monitor(state);
    return;
  }

  if (command === "merge") {
    mergeSponsorPartitions();
    return;
  }

  if (command === "stop") {
    await stop(state, Boolean(args.force), Boolean(args["no-merge"]));
    return;
  }

  if (command === "status") {
    printStatus(state);
    return;
  }

  console.log(`Unknown command: ${command}`);
  console.log("Use: init | start | monitor | status | stop | merge");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
