-- Stent 0005: sample_response — a truncated (~2KB) copy of the real response
-- from an endpoint's target_url, captured automatically the first time it
-- verifies. Shown on the marketplace detail page so an agent developer can
-- see what the data looks like before paying for it.
--
-- Nullable: capture is best-effort during verification and never blocks a
-- verification from succeeding. Read through the proxy's service-role
-- client (apps/proxy/src/registration.ts), the same path as the rest of
-- endpoint status — no anon/authenticated column grant is needed.

alter table public.endpoints
  add column if not exists sample_response text;
