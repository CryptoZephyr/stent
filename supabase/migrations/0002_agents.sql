-- Stent 0002: agent registry — an OPTIONAL profile that names a consuming wallet.
--
-- Mirrors the endpoints pattern (public read, service-role write, realtime CDC).
-- Identity is keyed entirely by wallet address and NEVER by a Supabase auth user
-- id, so the auth provider (Supabase Web3 today, Privy later) stays swappable
-- without touching this schema. Roles are derived from ownership, not stored:
-- an account is an "Agent Owner" iff it owns rows here.

create table if not exists public.agents (
  agent_wallet  text primary key
    constraint agents_agent_wallet_fmt check (agent_wallet ~ '^0x[0-9a-f]{40}$'),
  owner_wallet  text not null
    constraint agents_owner_wallet_fmt check (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  name          text not null,
  description   text,
  created_at    timestamptz not null default now()
);

create index if not exists agents_owner_idx
  on public.agents (owner_wallet, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — same posture as endpoints/payments.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agents enable row level security;

-- Public directory / leaderboard: anyone may read agent profiles.
drop policy if exists "public_read_agents" on public.agents;
create policy "public_read_agents"
  on public.agents for select
  using (true);

-- Only the service role (dashboard server, AFTER a wallet-signature ownership
-- check) may write. The service role bypasses RLS, so this documents intent and
-- gates any non-service writer.
drop policy if exists "service_write_agents" on public.agents;
create policy "service_write_agents"
  on public.agents for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.agents to anon, authenticated;
grant all privileges on public.agents to service_role;

-- Realtime CDC for the live fleet/leaderboard surfaces in later phases.
alter publication supabase_realtime add table public.agents;
