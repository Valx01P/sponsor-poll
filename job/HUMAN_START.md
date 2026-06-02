# Sponsor Poll Swarm

## Start

```bash
node job/scripts/sponsor-region-orchestrator.js start
```

This starts parallel Codex workers across the sponsor markets. By default it caps active workers at 24.

Use a smaller run when you want to test:

```bash
node job/scripts/sponsor-region-orchestrator.js start --max-active 4 florida texas canada
```

## Keep It Moving

```bash
node job/scripts/sponsor-region-orchestrator.js monitor
```

Leave this running to launch new batches as workers finish. It also prints estimated agent-hours and cost using `SPONSOR_SWARM_HOURLY_AGENT_COST` or `--hourly-cost`.

## Check Status

```bash
node job/scripts/sponsor-region-orchestrator.js status
```

Status shows markets that still need work, active workers, finished batches, missing outreach routes, under-target markets, and estimated session cost.

The scheduler is hands-off: it runs one worker per market at a time, rotates through markets by batch count, prioritizes American markets inside each pass, and only revisits a market after other markets with fewer batches have had a pass.

## Stop Gracefully

```bash
node job/scripts/sponsor-region-orchestrator.js stop
```

Stop writes `job/swarm/sponsor-region-stop.json`, waits for active workers to finish their current research batch, then merges partitions into:

- `job/sponsors.json`
- `client/data/sponsors.json`

Emergency stop:

```bash
node job/scripts/sponsor-region-orchestrator.js stop --force
```

Use `--no-merge` only when you intentionally want to stop without merging.

## One-Time Rebuild

```bash
node job/scripts/sponsor-region-orchestrator.js init
```

Only run `init` when no workers are active. It rebuilds one JSON partition per state, territory, district, or English-speaking country from `job/sponsors.json`.

## Reindex Semantic Search

Start the embedding server:

```bash
cd server
npm start
```

In another terminal:

```bash
cd client
npm run semantic:reindex
```

The app has no sign-in or sign-up. Smart search and CSV export are public, and contacted checkmarks are stored locally in the browser.
