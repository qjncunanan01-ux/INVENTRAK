-- Durable runtime settings (run once in the Supabase SQL Editor).
--
-- Cloud containers have ephemeral filesystems. This table lets owner-managed
-- settings survive API restarts and redeploys. The backend uses the existing
-- SUPABASE_URL + service-role SUPABASE_KEY; no credentials belong in the app.
--
-- Row-level security is enabled with no public policies. The service-role key
-- bypasses RLS; anon/authenticated clients receive no access.

create table if not exists system_settings (
  id integer primary key,
  idx integer not null default 0,
  data jsonb not null default '{}'
);

alter table system_settings enable row level security;
