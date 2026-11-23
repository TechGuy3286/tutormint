-- 244_pr17_demo_feedback_rating.sql (PR-17 Part B + D.4, owner 23 Nov 2026)
--
-- Javeria got "You received demo feedback — 5 out of 5" but no rating showed:
-- demo feedback was saved and linked to her completed demo, yet the rating
-- (tutor_profiles.rating_avg / rating_count) counted APPROVED HIRE REVIEWS
-- only (migration 204), demo_feedback had no trigger, and its rows are not
-- public. Owner decision (23 Nov 2026):
--   * a demo's STARS count in the tutor's rating at once — each demo once
--     (one feedback row per demo, unique) — and an edit updates it;
--   * the written COMMENT is pending until the Owner approves it in
--     Trust → Reviews; only an approved comment is shown publicly; an edited
--     comment goes back to pending;
--   * hire reviews keep their approval step (unchanged);
--   * no review structured data (unchanged).
-- The database enforces what the routes do: a member can only insert feedback
-- for their own completed demo, a parent can change only the stars and the
-- comment, a tutor only their reply, and nobody but the service role can
-- approve a comment.
--
-- Data: the 2 existing feedback rows get comment_status 'pending' (the
-- default) and their tutors' ratings are recomputed. Nothing is deleted.
-- Additive and re-runnable.

alter table public.demo_feedback
  add column if not exists comment_status text not null default 'pending',
  add column if not exists comment_decided_by uuid references auth.users(id) on delete set null,
  add column if not exists comment_decided_at timestamptz,
  add column if not exists comment_decision_reason text,
  add column if not exists updated_at timestamptz;

alter table public.demo_feedback drop constraint if exists demo_feedback_comment_status_check;
alter table public.demo_feedback add constraint demo_feedback_comment_status_check
  check (comment_status in ('pending', 'approved', 'rejected'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demo_feedback_rating_range') then
    alter table public.demo_feedback add constraint demo_feedback_rating_range check (rating is null or rating between 1 and 5);
  end if;
end $$;

-- Each demo is counted once.
create unique index if not exists demo_feedback_demo_uniq on public.demo_feedback (demo_request_id) where demo_request_id is not null;
create index if not exists demo_feedback_tutor_idx on public.demo_feedback (tutor_id);
create index if not exists demo_feedback_comment_status_idx on public.demo_feedback (comment_status, created_at);

-- ------------------------------------------------------------ the guard ----
create or replace function public.guard_demo_feedback()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  member boolean := coalesce(auth.role(), '') in ('authenticated', 'anon');
begin
  if not member then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.parent_id is distinct from auth.uid() then
      raise exception 'demo feedback: not your demo' using errcode = '42501';
    end if;
    if not exists (
      select 1 from demo_requests d
      where d.id = new.demo_request_id
        and d.parent_id = new.parent_id
        and d.tutor_id = new.tutor_id
        and d.status = 'completed'
    ) then
      raise exception 'demo feedback: the demo is not a completed demo of yours' using errcode = '42501';
    end if;
    new.comment_status := 'pending';
    new.comment_decided_by := null;
    new.comment_decided_at := null;
    new.comment_decision_reason := null;
    new.tutor_reply := null;
    return new;
  end if;

  -- UPDATE: who may change what.
  if new.parent_id is distinct from old.parent_id
     or new.tutor_id is distinct from old.tutor_id
     or new.demo_request_id is distinct from old.demo_request_id
     or new.created_at is distinct from old.created_at then
    raise exception 'demo feedback: these fields cannot change' using errcode = '42501';
  end if;

  if auth.uid() = old.parent_id then
    if new.tutor_reply is distinct from old.tutor_reply then
      raise exception 'demo feedback: only the tutor replies' using errcode = '42501';
    end if;
    if new.feedback_text is distinct from old.feedback_text then
      -- An edited comment waits for approval again.
      new.comment_status := 'pending';
      new.comment_decided_by := null;
      new.comment_decided_at := null;
      new.comment_decision_reason := null;
    else
      new.comment_status := old.comment_status;
      new.comment_decided_by := old.comment_decided_by;
      new.comment_decided_at := old.comment_decided_at;
      new.comment_decision_reason := old.comment_decision_reason;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if auth.uid() = old.tutor_id then
    if new.rating is distinct from old.rating
       or new.feedback_text is distinct from old.feedback_text
       or new.comment_status is distinct from old.comment_status
       or new.comment_decided_by is distinct from old.comment_decided_by
       or new.comment_decided_at is distinct from old.comment_decided_at
       or new.comment_decision_reason is distinct from old.comment_decision_reason then
      raise exception 'demo feedback: a tutor may only reply' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'demo feedback: not yours' using errcode = '42501';
end;
$function$;

drop trigger if exists demo_feedback_guard on public.demo_feedback;
create trigger demo_feedback_guard
  before insert or update on public.demo_feedback
  for each row execute function public.guard_demo_feedback();

-- ------------------------------------------------------- rating rollup ----
-- One rule for both sources: approved hire reviews + every demo's stars.
create or replace function public.recompute_rating_for(p_tutor uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_tutor is null then
    return;
  end if;
  update tutor_profiles tp
     set rating_avg = coalesce(agg.avg_rating, 0),
         rating_count = coalesce(agg.n, 0)
    from (
      select round(avg(x.rating)::numeric, 2) as avg_rating, count(*) as n
      from (
        select r.rating from reviews r
        where r.tutor_id = p_tutor and r.rating is not null and r.status = 'approved'
        union all
        select f.rating from demo_feedback f
        where f.tutor_id = p_tutor and f.rating is not null
      ) x
    ) agg
   where tp.id = p_tutor
     and (tp.rating_avg is distinct from coalesce(agg.avg_rating, 0)
          or tp.rating_count is distinct from coalesce(agg.n, 0));
end;
$function$;
revoke all on function public.recompute_rating_for(uuid) from public, anon, authenticated;
grant execute on function public.recompute_rating_for(uuid) to service_role;

create or replace function public.recompute_tutor_rating()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recompute_rating_for(new.tutor_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.tutor_id is distinct from new.tutor_id) then
    perform public.recompute_rating_for(old.tutor_id);
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists demo_feedback_recompute_rating on public.demo_feedback;
create trigger demo_feedback_recompute_rating
  after insert or delete or update of rating, tutor_id on public.demo_feedback
  for each row execute function public.recompute_tutor_rating();

-- The tutors who already have demo feedback (2 today).
do $$
declare
  t uuid;
begin
  for t in select distinct tutor_id from public.demo_feedback where tutor_id is not null loop
    perform public.recompute_rating_for(t);
  end loop;
end $$;

-- ------------------------------------------------ the public tutor page ----
-- The live definition with the reviews list widened: approved hire reviews
-- plus demo feedback whose comment the Owner approved ('source' tells them apart).
do $$
declare
  def text;
  needle constant text := $n$      from reviews r
      left join profiles rp on rp.id = r.parent_id
      where r.tutor_id = d.id and r.status = 'approved'
    ), '[]'::jsonb),$n$;
  repl constant text := $r$      from (
        select r.id, r.rating, r.comment, r.created_at, r.parent_id, 'hire'::text as source
        from reviews r
        where r.tutor_id = d.id and r.status = 'approved'
        union all
        select f.id, f.rating, f.feedback_text, f.created_at, f.parent_id, 'demo'::text
        from demo_feedback f
        where f.tutor_id = d.id and f.comment_status = 'approved'
          and coalesce(btrim(f.feedback_text), '') <> ''
      ) r
      left join profiles rp on rp.id = r.parent_id
    ), '[]'::jsonb),$r$;
begin
  def := pg_get_functiondef('public.tutor_public_page(text)'::regprocedure);
  if position('demo_feedback f' in def) > 0 then
    return; -- already widened
  end if;
  if position(needle in def) = 0 then
    raise exception 'tutor_public_page: the reviews list was not found — nothing changed';
  end if;
  def := replace(def, needle, repl);
  def := replace(def, $o$'created_at', r.created_at,$o$, $o$'created_at', r.created_at, 'source', r.source,$o$);
  execute def;
end $$;
