-- Workspace-level daily digest preferences and lightweight event usefulness feedback.
create table if not exists public.workspace_alert_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  email text,
  digest_enabled boolean not null default false,
  signals text[] not null default array['pricing','launches','news','hiring','positioning']::text[],
  last_digest_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.event_feedback (
  event_id uuid primary key references public.events(id) on delete cascade,
  rating text not null check (rating in ('useful','not_useful')),
  created_at timestamptz not null default now()
);

comment on table public.workspace_alert_settings is 'Workspace recipient and signal filters for daily competitor change email.';
