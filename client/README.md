## Sponsor Poll Client

No auth is used in this app. Smart search and CSV export are public, and contacted checkmarks are stored in browser local storage.

## Local Dev

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

For semantic search, run the local embedding server from `../server` and reindex:

```bash
cd ../server
npm start
```

```bash
cd ../client
npm run semantic:reindex
```

## Supabase

`npm run semantic:reindex` runs:

- `scripts/setup-db.ts`
- `scripts/clear-embeddings.ts`
- `scripts/embed-sponsors.ts`

If direct DB access is blocked, paste `supabase/schema.sql` into the Supabase SQL editor, then run:

```bash
npm run clear:embeddings
npm run embed
```
