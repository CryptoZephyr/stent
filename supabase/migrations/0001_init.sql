-- Stent initial schema: endpoint registry + payment audit log.
-- Supabase is the authoritative source of truth (system_design.md §3).

-- ─────────────────────────────────────────────────────────────────────────────
-- endpoints — publisher-registered, paywalled reverse-proxy targets
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.endpoints (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  slug              text not null unique,
  publisher_wallet  text not null,                    -- payTo (USDC recipient)
  price_usdc        text not null,                     -- decimal string, e.g. "0.001"
  target_url        text not null,                     -- upstream; MUST be https
  description       text,
  rate_limit_rpm    integer not null default 100,      -- per-endpoint req/min
  agent_limit_rpm   integer not null default 10,       -- per-agent-wallet req/min
  verification_token text,                             -- expected in stent-verification.txt
  verified          boolean not null default false,    -- URL ownership proven
  active            boolean not null default true,
  -- TLS-only for public upstreams (security rule). Loopback is allowed so the
  -- proxy can be tested end-to-end against a local demo origin.
  constraint target_url_https check (
    target_url like 'https://%'
    or target_url like 'http://localhost%'
    or target_url like 'http://127.0.0.1%'
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- payments — append-only audit trail; nonce dedup + replay protection
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  endpoint_slug            text not null references public.endpoints(slug),
  publisher_wallet         text not null,
  agent_address            text not null,
  amount_usdc              numeric not null,
  network                  text not null default 'eip155:5042002',
  -- Unique authorization id (nonce / settlement tx). The UNIQUE constraint is
  -- the replay guard: a duplicate insert fails, and the proxy treats that as a
  -- rejected replay.
  gateway_authorization_id text not null unique
);

create index if not exists payments_publisher_idx
  on public.payments (publisher_wallet, created_at desc);
create index if not exists payments_endpoint_idx
  on public.payments (endpoint_slug, created_at desc);
create index if not exists payments_agent_idx
  on public.payments (agent_address, created_at desc);
create index if not exists payments_auth_idx
  on public.payments (gateway_authorization_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.endpoints enable row level security;
alter table public.payments  enable row level security;

-- Public directory: anyone may read live, verified endpoints.
drop policy if exists "public_read_endpoints" on public.endpoints;
create policy "public_read_endpoints"
  on public.endpoints for select
  using (active = true and verified = true);

-- Payment feed is public read (dashboard transparency / traction evidence).
drop policy if exists "public_read_payments" on public.payments;
create policy "public_read_payments"
  on public.payments for select
  using (true);

-- Only the service role (proxy / dashboard server) may write.
-- NOTE: the service role bypasses RLS entirely, so these policies primarily
-- document intent and gate any non-service writers.
drop policy if exists "service_write_payments" on public.payments;
create policy "service_write_payments"
  on public.payments for insert
  with check (auth.role() = 'service_role');

drop policy if exists "service_write_endpoints" on public.endpoints;
create policy "service_write_endpoints"
  on public.endpoints for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — PostgREST connects as anon / authenticated / service_role. These
-- roles need table-level privileges in addition to RLS. (Supabase normally
-- applies these via default privileges; granting explicitly makes the migration
-- self-contained and reproducible.) RLS still gates anon/authenticated writes.
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
grant select on public.endpoints to anon, authenticated;
grant select on public.payments  to anon, authenticated;
grant all privileges on public.endpoints to service_role;
grant all privileges on public.payments  to service_role;

-- Realtime CDC for the dashboard live feed + proxy cache invalidation.
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.endpoints;
