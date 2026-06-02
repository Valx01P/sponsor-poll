# Sponsor Poll Swarm

## Start

```bash
node job/scripts/sponsor-region-orchestrator.js start
```

This starts parallel Codex workers across the contiguous mainland U.S. state markets and keeps launching new batches until you stop it. By default it caps active workers at 24 and does not launch global country, U.S. territory, D.C., Alaska, or Hawaii markets.

The swarm is continuous: after a market reaches its target, it keeps coming back for enrichment and expansion batches until you stop it.

Raise the target when you want under-target markets to be prioritized more aggressively:

```bash
node job/scripts/sponsor-region-orchestrator.js start --target 20
```

Use a smaller run when you want to test:

```bash
node job/scripts/sponsor-region-orchestrator.js start --max-active 4 florida texas california
```

Global country markets are opt-in:

```bash
node job/scripts/sponsor-region-orchestrator.js start --global
```

Other broad scopes:

```bash
node job/scripts/sponsor-region-orchestrator.js start --us-states
node job/scripts/sponsor-region-orchestrator.js start --us-all
node job/scripts/sponsor-region-orchestrator.js start --all
```

## Reattach Or Keep It Moving

```bash
node job/scripts/sponsor-region-orchestrator.js monitor
```

Leave this running to launch new batches as workers finish. It also prints estimated agent-hours and cost using `SPONSOR_SWARM_HOURLY_AGENT_COST` or `--hourly-cost`.

Use `monitor` if the original `start` terminal was closed or if workers are already active and you want to keep the launcher running.

## Check Status

```bash
node job/scripts/sponsor-region-orchestrator.js status
```

Status shows the active launch scope, continuous research mode, queued markets, active workers, finished batches, missing outreach routes, under-target markets, and estimated session cost.

It reports scope totals first, then all-market totals when those differ. This keeps the default mainland U.S. run from looking like it is trying to launch all 96 markets.

The scheduler is hands-off: it runs one worker per market at a time, rotates through markets by batch count, and only revisits a market after other markets in the active scope with fewer batches have had a pass.

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
