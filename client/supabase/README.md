# Sponsor Poll Supabase Setup

This app does not use sign-in or sign-up.

Run automatically when the DB URL works:

```bash
npm run semantic:reindex
```

If local Postgres access fails, paste `schema.sql` into the Supabase SQL editor. Then run:

```bash
npm run clear:embeddings
npm run embed
```

The only table created by this schema is `sponsor_embeddings`; there are no auth or user tables.
