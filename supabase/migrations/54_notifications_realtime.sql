-- 54_notifications_realtime.sql
-- Put `notifications` into the supabase_realtime publication so the header bell
-- can receive a live INSERT event and increment its badge without a reload.
--
-- The browser subscribes with a `user_id=eq.<me>` filter, and Realtime applies
-- the table's RLS (notifications_own_read) on top — so a member is delivered
-- only their own new notifications, never anyone else's. Additive and
-- idempotent; no data changes.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     )
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
