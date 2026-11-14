-- Competitor Radar schema. Paste into Supabase → SQL Editor and run once.

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null,
  description text,
  logo_url text,
  status text not null default 'discovering',  -- discovering | review | watching | error
  status_detail text,
  created_at timestamptz not null default now()
);

create table competitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  domain text not null,
  why text,
  logo_url text,
  pricing_url text,
  blog_url text,
  careers_url text,
  homepage_url text,
  is_sandbox boolean not null default false,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

-- One row per Context.dev monitor. `id` is ours and is part of the webhook URL,
-- so the receiver can look up `webhook_secret` before trusting the body.
create table monitors (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  signal text not null check (signal in ('pricing', 'launches', 'news', 'hiring', 'positioning')),
  context_monitor_id text unique,
  webhook_secret text,
  target jsonb not null,
  status text not null default 'pending',
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  monitor_id uuid references monitors(id) on delete set null,
  signal text not null,
  context_event_id text unique not null,      -- X-Context-Id, for dedupe
  title text,
  summary text,
  importance text,                             -- low | medium | high
  url text,
  diff text,
  raw jsonb not null,
  detected_at timestamptz,                     -- change.detected_at from Context.dev
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  battlecard_updated_at timestamptz
);
create index on events (competitor_id, received_at desc);

create table battlecards (
  competitor_id uuid primary key references competitors(id) on delete cascade,
  pricing jsonb,                               -- { plans: Plan[], captured_at }
  launches jsonb not null default '[]',        -- [{ title, url, at }]
  news jsonb not null default '[]',
  hiring jsonb not null default '[]',
  positioning jsonb,
  how_to_win text,
  updated_at timestamptz not null default now(),
  last_event_id uuid references events(id) on delete set null
);

create table pricing_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  captured_at timestamptz not null,
  source text not null check (source in ('wayback', 'live')),
  plans jsonb not null
);
create index on pricing_snapshots (competitor_id, captured_at);

-- Context.dev batch jobs (Wayback pricing backfill). Private: holds the batch webhook secret.
create table batches (
  id text primary key,                         -- Context.dev batch id
  workspace_id uuid not null references workspaces(id) on delete cascade,
  webhook_secret text not null,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

-- Drives the fake demo competitor at /sandbox; edited live from /sandbox/admin.
create table sandbox_content (
  page text primary key,                       -- 'pricing' | 'blog' | 'careers'
  content jsonb not null,
  updated_at timestamptz not null default now()
);

insert into sandbox_content (page, content) values
  ('pricing', '{"plans": [
     {"name": "Starter", "price": 0,  "limits": "1,000 pages / month"},
     {"name": "Pro",     "price": 49, "limits": "50,000 pages / month"},
     {"name": "Scale",   "price": 299,"limits": "1,000,000 pages / month"}
   ]}'),
  ('blog', '{"posts": [
     {"slug": "hello-world", "title": "Introducing Scrapr", "date": "2026-09-01", "body": "Scrapr turns any website into JSON."}
   ]}'),
  ('careers', '{"jobs": [
     {"title": "Senior Backend Engineer", "location": "Remote (EU)"}
   ]}');

-- Hackathon: no auth. Anyone with the anon key can read; only the server (service role) writes.
alter table workspaces enable row level security;
alter table competitors enable row level security;
alter table monitors enable row level security;
alter table events enable row level security;
alter table battlecards enable row level security;
alter table pricing_snapshots enable row level security;
alter table sandbox_content enable row level security;
alter table batches enable row level security;
create policy "public read" on workspaces for select using (true);
create policy "public read" on competitors for select using (true);
create policy "public read" on events for select using (true);
create policy "public read" on battlecards for select using (true);
create policy "public read" on pricing_snapshots for select using (true);
create policy "public read" on sandbox_content for select using (true);
-- monitors and batches hold webhook secrets: no public read.

alter publication supabase_realtime add table workspaces, events, battlecards, competitors;
