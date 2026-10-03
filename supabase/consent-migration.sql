-- Run this ONCE in the Supabase SQL Editor BEFORE deploying the consent change.
-- It only adds a column, so it is safe to run while sign-ups are live.
-- Old rows keep consented_at empty (they signed up before the checkbox existed).
alter table leads add column if not exists consented_at timestamptz;
