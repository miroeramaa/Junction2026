-- Workspace-level strategic interpretations. Existing data and policies are unchanged.
create table if not exists public.market_briefs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  content jsonb,
  generated_at timestamptz,
  input_fingerprint text,
  status text not null default 'idle' check (status in ('idle', 'generating', 'ready', 'error')),
  last_attempt_at timestamptz,
  lease_until timestamptz
);
alter table public.market_briefs enable row level security;
-- Access is through the app's workspace-scoped server API; no public write policy.
