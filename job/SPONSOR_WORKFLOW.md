# Sponsor Poll Lead Workflow

## Files

- `job/sponsors.json` is the canonical knowledge base.
- `client/data/sponsors.json` is the frontend copy.
- `job/regions/sponsor-*.json` are temporary worker partitions, one market per file.
- `job/swarm/sponsor-region-state.json` tracks active workers, batches, and cost estimates.
- `job/swarm/sponsor-region-stop.json` tells workers and the orchestrator not to launch more work.

## Worker Priorities

1. Fix prospects or contacts that lack direct outreach routes.
2. Fill empty markets.
3. Bring markets up to their priority target.
4. Enrich useful context for existing leads.
5. Keep expanding markets with new high-fit prospects until stopped.

The orchestrator prevents overlap by allowing only one active worker per market ID. It also rotates by batch count: markets with fewer completed batches are launched first, so the swarm makes broad passes across the active launch scope before returning to a market for a deeper pass.

Default launch scope is the contiguous mainland U.S. state markets. Global country markets are only launched with `--global`, and full-database sweeps require `--all`.

Priority targets:

- P1: 15 prospects
- P2: 10 prospects
- P3: 6 prospects

Targets are priority floors, not stopping rules. Markets keep queueing for enrichment/expansion after they hit target. Use `start --target 20` when you want markets below that count to move earlier in the launch order.

## Lead Criteria

Good sponsor prospects include:

- Issue advocacy groups
- PACs and ballot measure committees
- Campaigns and political consultants
- Chambers of commerce and trade associations
- Civic organizations and universities
- Media organizations
- Donors, business owners, and public affairs firms
- Companies with a clear stake in local policy or public sentiment

Each prospect should include as much of this as can be found reliably:

- Website or contact URL
- Contact person with title
- Email, LinkedIn, phone, or contact form
- Location
- Political leaning when public context supports it
- Sponsor fit and likely poll topics
- Prior poll sponsorship or related sponsorship history
- Estimated budget band
- Notes with concise source-aware reasoning

Workers save in small batches instead of trying to finish a market in one run:

- Empty markets: 4 to 6 verified prospects.
- Non-empty markets: 3 to 5 new prospects, or up to 8 outreach-route fixes.
- Complete markets: 3 to 5 additional high-fit sponsor prospects, or material improvements to existing prospect/contact details.
- After each batch, the worker validates the JSON partition and exits so the orchestrator can rotate to another market.

## Merge Rule

Merges are additive. `merge-sponsor-partitions.js` unions canonical data with partition data and dedupes exact or near-exact prospects and contacts. A worker omission should not delete existing aggregate leads.

## Semantic Search

`client/scripts/embed-sponsors.ts` embeds every market row into Supabase `sponsor_embeddings`. The embedding text includes market fields plus all prospect and contact details. Re-run:

```bash
cd client
npm run semantic:reindex
```

after large data updates.
