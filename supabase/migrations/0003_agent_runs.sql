-- Stent 0003: agent run + lifecycle-step events powering the Agent Console.
--
-- Append-only, and mirrors the `payments` pattern exactly: public read, service-
-- role write, Realtime CDC. The console visualizes the REAL Stent payment
-- lifecycle — reasoning → selected → payment → response — and `payment` steps
-- carry authentic `client.pay()` data (amount + settlement ref), not synthetic
-- logs. Identity is keyed by wallet address only (never a Supabase user id), so
-- the auth provider stays swappable and runs from any wallet (claimed or not).

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_runs — one row per autonomous agent task
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_runs (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  agent_wallet      text not null
    constraint agent_runs_wallet_fmt check (agent_wallet ~ '^0x[0-9a-f]{40}$'),
  goal              text not null,
  status            text not null default 'running'
    constraint agent_runs_status_chk check (status in ('running', 'complete', 'failed')),
  total_spent_usdc  numeric,                          -- real spend summary, set on finish
  payment_count     integer,
  finished_at       timestamptz
);

create index if not exists agent_runs_recent_idx on public.agent_runs (created_at desc);
create index if not exists agent_runs_wallet_idx on public.agent_runs (agent_wallet, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_run_steps — ordered lifecycle steps within a run
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_run_steps (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.agent_runs(id) on delete cascade,
  seq           integer not null,                     -- monotonic order within the run
  created_at    timestamptz not null default now(),
  kind          text not null
    constraint agent_run_steps_kind_chk
    check (kind in ('reasoning', 'selected', 'payment', 'response', 'complete', 'blocked', 'error')),
  title         text,
  detail        text,
  endpoint_slug text,                                 -- the paid endpoint (lifecycle steps)
  amount_usdc   numeric,                              -- real amount for `payment` steps
  tx_ref        text,                                 -- facilitator settlement reference
  unique (run_id, seq)
);

create index if not exists agent_run_steps_run_idx on public.agent_run_steps (run_id, seq);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — public read (console is public), service-role write only.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agent_runs      enable row level security;
alter table public.agent_run_steps enable row level security;

drop policy if exists "public_read_agent_runs" on public.agent_runs;
create policy "public_read_agent_runs" on public.agent_runs for select using (true);

drop policy if exists "public_read_agent_run_steps" on public.agent_run_steps;
create policy "public_read_agent_run_steps" on public.agent_run_steps for select using (true);

drop policy if exists "service_write_agent_runs" on public.agent_runs;
create policy "service_write_agent_runs" on public.agent_runs for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service_write_agent_run_steps" on public.agent_run_steps;
create policy "service_write_agent_run_steps" on public.agent_run_steps for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — PostgREST roles. RLS still gates anon/authenticated writes.
-- ─────────────────────────────────────────────────────────────────────────────
grant select on public.agent_runs      to anon, authenticated;
grant select on public.agent_run_steps to anon, authenticated;
grant all privileges on public.agent_runs      to service_role;
grant all privileges on public.agent_run_steps to service_role;

-- Realtime CDC for the live console.
alter publication supabase_realtime add table public.agent_runs;
alter publication supabase_realtime add table public.agent_run_steps;
