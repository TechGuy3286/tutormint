-- 178_tuitions_on_google.sql (owner, 16 Oct 2026) — additive, idempotent.
--
-- 1. A PAUSED tuition keeps its page, indexable and in the sitemap, for 60 days
--    after it was paused (then noindex and out of the sitemap; the page itself
--    stays live). indexable_tuitions() is the sitemap's (and the "Newest
--    tuitions" blocks') bulk read: open tuitions, plus paused ones paused in the
--    last 60 days — with the same fixture / test-poster / thin-description rules
--    as indexable_job_slugs() (which stays, unchanged, for older callers).
-- 2. The Indexing API queue: a priority (new posts first), retries with backoff
--    (attempts, next_attempt_at), and indexing_attempts — one row per request
--    actually made to Google, so "sent today" counts the requests Google counts
--    and the admin health box can chart the last 7 days. Backfilled from the
--    queue rows already sent (superseded rows are not attempts).
-- No existing row's meaning changes; nothing is deleted.

alter table public.indexing_queue add column if not exists priority smallint not null default 0;
alter table public.indexing_queue add column if not exists attempts integer not null default 0;
alter table public.indexing_queue add column if not exists next_attempt_at timestamptz;

create index if not exists indexing_queue_pending_prio_idx
  on public.indexing_queue (priority desc, created_at) where sent_at is null;

create table if not exists public.indexing_attempts (
  id            bigserial primary key,
  queue_id      bigint references public.indexing_queue (id) on delete set null,
  url           text not null,
  kind          text not null check (kind in ('URL_UPDATED', 'URL_DELETED')),
  attempted_at  timestamptz not null default now(),
  ok            boolean not null,
  error         text
);
create index if not exists indexing_attempts_at_idx on public.indexing_attempts (attempted_at desc);
alter table public.indexing_attempts enable row level security;
drop policy if exists indexing_attempts_admin_read on public.indexing_attempts;
create policy indexing_attempts_admin_read on public.indexing_attempts
  for select to authenticated using (public.is_admin());

-- Backfill: every queue row that was really sent (not a superseded marker),
-- once. A quota refusal put its row back (sent_at null), so it has no attempt.
insert into public.indexing_attempts (queue_id, url, kind, attempted_at, ok, error)
select q.id, q.url, q.kind, q.sent_at, q.last_error is null, q.last_error
from public.indexing_queue q
where q.sent_at is not null
  and q.sent_at > '1971-01-01'
  and coalesce(q.last_error, '') <> 'superseded'
  and not exists (select 1 from public.indexing_attempts a where a.queue_id = q.id);

create or replace function public.indexable_tuitions()
 returns table(
   id uuid, public_slug text, city text, title text, status text,
   created_at timestamptz, resumed_at timestamptz, refreshed_at timestamptz,
   bumped_at timestamptz, paused_at timestamptz
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select j.id, j.public_slug, j.city, j.title, j.status,
         j.created_at, j.resumed_at, j.refreshed_at, j.bumped_at, j.paused_at
  from jobs j
  join profiles p on p.id = j.parent_id
  where (
      j.status = 'open'
      or (j.status = 'paused' and j.paused_at is not null and j.paused_at > now() - interval '60 days')
    )
    and j.merged_into is null
    and j.public_slug is not null
    and char_length(btrim(coalesce(j.description, ''))) >= 40
    and coalesce(p.is_test_name, false) = false
    and (
      coalesce(p.is_team_account, false) = true
      or (
        coalesce(p.is_seed, false) = false
        and j.job_tx_id not ilike 'JOB-TRK%'
        and j.job_tx_id not ilike 'SEED-JOB%'
      )
    );
$function$;

revoke all on function public.indexable_tuitions() from public;
grant execute on function public.indexable_tuitions() to anon, authenticated, service_role;
