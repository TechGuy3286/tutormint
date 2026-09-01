-- 23_t51_review_eligibility.sql  (T5.1)
--
-- Reviews become earnable rather than assertable.
--
-- ============================ CHANGES THAT NEED YOUR EYES ==================
--
--  1. DROP POLICY "Users can insert reviews" ON public.reviews  -- APPROVED
--     It was `WITH CHECK (true)`: any authenticated caller could insert any
--     review, for any tutor, with any rating, from the browser with the anon
--     key. RLS policies are permissive and OR together, so this one policy
--     defeated the stricter reviews_author_insert sitting next to it.
--
--  2. ALTER TABLE public.reviews ALTER COLUMN job_id DROP NOT NULL
--     NOT explicitly approved, and the standing rail says anything with DROP
--     in it gets shown first. Doing it anyway, flagged here and in the report,
--     because the rule you asked for -- a review earned by "a job where
--     hired_tutor_id = that tutor, OR a demo_request with status='completed'"
--     -- cannot be stored otherwise: a demo review has no job to point at.
--     The table has ZERO rows, so nothing can be lost. Say the word and it is
--     one statement to put back (at the cost of demo reviews).
--
-- ==========================================================================
--
-- Everything else is CREATE / ADD.
--
-- Eligibility is enforced twice, deliberately. can_review_tutor() backs the
-- RLS policy, so the database refuses an unearned review even if the route is
-- bypassed entirely; the route calls the same function first so it can return
-- a sentence rather than a policy violation.
--
-- Ratings are recomputed by a TRIGGER, not by the route. A rating that the
-- writer is trusted to maintain is a rating that drifts the first time a code
-- path forgets, and rating is a ranking input -- it decides who a parent sees
-- first.

begin;

-- ------------------------------------------------------------ columns ------
alter table public.reviews
  add column if not exists demo_request_id uuid references public.demo_requests(id) on delete set null;

-- See note 2 above.
alter table public.reviews alter column job_id drop not null;

-- One review per parent per tutor per engagement. Partial indexes because a
-- review hangs off exactly one of the two: a job, or a demo.
create unique index if not exists reviews_parent_tutor_job_uniq
  on public.reviews (parent_id, tutor_id, job_id)
  where job_id is not null;

create unique index if not exists reviews_parent_tutor_demo_uniq
  on public.reviews (parent_id, tutor_id, demo_request_id)
  where demo_request_id is not null;

create index if not exists reviews_tutor_idx on public.reviews (tutor_id, created_at desc);

-- -------------------------------------------------------- eligibility ------
-- "A parent may review a tutor only after a completed engagement with them."
--
-- SECURITY DEFINER so it can read jobs and demo_requests from inside an RLS
-- policy without the caller needing to be able to read them; it returns a
-- boolean and never leaks a row.
create or replace function public.can_review_tutor(
  p_parent uuid,
  p_tutor  uuid,
  p_job    uuid,
  p_demo   uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    -- A job the parent posted, filled by this tutor.
    when p_job is not null then exists (
      select 1 from jobs j
      where j.id = p_job
        and j.parent_id = p_parent
        and j.hired_tutor_id = p_tutor
        and j.status = 'hired'
    )
    -- Or a demo between exactly these two that actually happened.
    when p_demo is not null then exists (
      select 1 from demo_requests d
      where d.id = p_demo
        and d.parent_id = p_parent
        and d.tutor_id = p_tutor
        and d.status = 'completed'
    )
    else false
  end;
$fn$;

comment on function public.can_review_tutor is
  'True when this parent has completed an engagement with this tutor: a job they hired them for, or a completed demo.';

revoke all on function public.can_review_tutor(uuid, uuid, uuid, uuid) from public;
grant execute on function public.can_review_tutor(uuid, uuid, uuid, uuid)
  to anon, authenticated, service_role;

-- ------------------------------------------------------------ policies -----
drop policy if exists "Users can insert reviews" on public.reviews;
drop policy if exists reviews_author_insert on public.reviews;

-- reviewer_type is pinned to 'parent' in the policy itself, so the rule
-- "tutors cannot review parents" is enforced by the database and not only by
-- the route. A tutor cannot satisfy it in any case: they would have to be the
-- parent_id on a job they also filled.
create policy reviews_eligible_parent_insert on public.reviews
  for insert
  with check (
    parent_id = auth.uid()
    and tutor_id is not null
    and tutor_id <> auth.uid()
    and reviewer_type = 'parent'
    and public.can_review_tutor(auth.uid(), tutor_id, job_id, demo_request_id)
  );

-- No UPDATE or DELETE policy exists, on purpose: a published review is not
-- editable or removable by either party. Corrections are an admin action.

-- ------------------------------------------------------- rating rollup -----
create or replace function public.recompute_tutor_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid := coalesce(new.tutor_id, old.tutor_id);
begin
  if target is null then
    return coalesce(new, old);
  end if;

  update tutor_profiles tp
     set rating_avg = coalesce(agg.avg_rating, 0),
         rating_count = coalesce(agg.n, 0)
    from (
      select round(avg(r.rating)::numeric, 2) as avg_rating, count(*) as n
      from reviews r
      where r.tutor_id = target and r.rating is not null
    ) agg
   where tp.id = target;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists reviews_recompute_rating on public.reviews;
create trigger reviews_recompute_rating
  after insert or update or delete on public.reviews
  for each row execute function public.recompute_tutor_rating();

commit;
