-- Stent 0004: restrict anon/authenticated to SAFE columns of `endpoints`.
--
-- 0001 did a table-level `grant select on endpoints to anon, authenticated`.
-- RLS (`public_read_endpoints`) gates which ROWS are visible (active + verified)
-- but NOT which COLUMNS — so an anon client could read `target_url` (a
-- paywall-bypass risk: call the publisher's origin directly, unpaid) and any
-- leftover `verification_token`.
--
-- Fix: replace the table-wide grant with a COLUMN-level grant that excludes
-- `target_url` and `verification_token`. The proxy reads via the service role
-- (`grant all ... to service_role`, unchanged), so endpoint resolution and
-- ownership verification are unaffected; the dashboard reads endpoints only
-- through the proxy's `/_api` directory (service role), so nothing breaks.

revoke select on public.endpoints from anon, authenticated;

grant select (
  id,
  created_at,
  slug,
  publisher_wallet,
  price_usdc,
  description,
  rate_limit_rpm,
  agent_limit_rpm,
  verified,
  active
) on public.endpoints to anon, authenticated;
