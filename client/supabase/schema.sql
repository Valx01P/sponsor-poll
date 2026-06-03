create extension if not exists vector;

create table if not exists public.sponsor_embeddings (
  id text primary key,
  market_id text not null,
  prospect_id text,
  prospect_name text,
  content_type text not null default 'market',
  name text not null,
  region_type text not null,
  country text not null,
  region text not null,
  priority integer not null,
  prospect_count integer not null default 0,
  contact_count integer not null default 0,
  content text not null,
  embedding vector(384) not null,
  updated_at timestamptz not null default now()
);

alter table public.sponsor_embeddings
  add column if not exists market_id text,
  add column if not exists prospect_id text,
  add column if not exists prospect_name text,
  add column if not exists content_type text not null default 'market';

update public.sponsor_embeddings
set market_id = id
where market_id is null;

update public.sponsor_embeddings
set content_type = 'market'
where content_type is null;

alter table public.sponsor_embeddings
  alter column market_id set not null,
  alter column content_type set default 'market',
  alter column content_type set not null;

create index if not exists sponsor_embeddings_embedding_hnsw
  on public.sponsor_embeddings using hnsw (embedding vector_cosine_ops);

create index if not exists sponsor_embeddings_market_id_idx
  on public.sponsor_embeddings (market_id);

alter table public.sponsor_embeddings enable row level security;

drop policy if exists "Public sponsor embeddings are readable" on public.sponsor_embeddings;
create policy "Public sponsor embeddings are readable"
  on public.sponsor_embeddings
  for select
  using (true);

drop function if exists public.match_sponsor_markets(vector, float, int);

create or replace function public.match_sponsor_markets(
  query_embedding vector(384),
  match_threshold float default 0,
  match_count int default 100
)
returns table (
  id text,
  row_id text,
  market_id text,
  prospect_id text,
  prospect_name text,
  content_type text,
  name text,
  region_type text,
  country text,
  region text,
  priority integer,
  prospect_count integer,
  contact_count integer,
  similarity float
)
language sql
stable
as $$
  select
    sponsor_embeddings.market_id as id,
    sponsor_embeddings.id as row_id,
    sponsor_embeddings.market_id,
    sponsor_embeddings.prospect_id,
    sponsor_embeddings.prospect_name,
    sponsor_embeddings.content_type,
    sponsor_embeddings.name,
    sponsor_embeddings.region_type,
    sponsor_embeddings.country,
    sponsor_embeddings.region,
    sponsor_embeddings.priority,
    sponsor_embeddings.prospect_count,
    sponsor_embeddings.contact_count,
    1 - (sponsor_embeddings.embedding <=> query_embedding) as similarity
  from public.sponsor_embeddings
  where 1 - (sponsor_embeddings.embedding <=> query_embedding) >= match_threshold
  order by sponsor_embeddings.embedding <=> query_embedding
  limit match_count;
$$;
