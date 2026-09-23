-- 105_lock_featured_insert.sql (PR49 §3) — close the last PR47 hole.
--
-- PR48 locked UPDATE of the privileged columns, but a member could still POST a
-- NEW job to /rest/v1/jobs with is_featured already true — free promotion the
-- Featured plan is paid for. createJob now inserts through the service role
-- (deployed first), which sets is_featured from the parent's plan and bypasses
-- grants, so this revoke breaks no legitimate flow: it withdraws table-level
-- INSERT on jobs from authenticated/anon and re-grants INSERT on every column
-- EXCEPT is_featured. A member insert that omits is_featured uses the default
-- (false); one that sets is_featured is refused. The Featured tag is now only
-- ever set by the server, after payment.

do $$
declare
  allowed text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into allowed
    from information_schema.columns
   where table_schema='public' and table_name='jobs'
     and column_name <> 'is_featured';
  revoke insert on public.jobs from authenticated, anon;
  execute format('grant insert (%s) on public.jobs to authenticated, anon', allowed);
end $$;
