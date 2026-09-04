-- 51_content_queue.sql
-- Blog CMS, part 3 (CLAUDE.md 9.4): the content queue.
--
-- One table. The signals that fill it read tables that already exist
-- (user_activity_log, landing_combinations, reports, posts); nothing else
-- changes shape.
--
-- WRITES GO THROUGH THE SERVICE ROLE, like posts and notifications: one
-- admin-read SELECT policy and no write policy at all, so there is nothing a
-- browser key can write and nothing for a browser key to read unless it is an
-- admin. The nightly rebuild and the snooze/dismiss/draft actions all hold the
-- service key.

create table if not exists public.content_suggestions (
  id uuid primary key default gen_random_uuid(),

  -- A stable identity for a topic, so the nightly rebuild UPSERTS rather than
  -- piling up duplicates, and so a decision (dismiss/snooze/draft) sticks to
  -- the same topic across rebuilds. e.g. "search:tutors:249:lahore",
  -- "calendar:oa-level-oct:2026", "coverage:tutors/lahore/o-levels-physics".
  fingerprint text not null unique,

  -- Two card kinds on one screen: a blog topic, or a recruitment gap routed to
  -- the import manager (high searches, few tutors — not a post).
  card text not null default 'content' check (card in ('content', 'recruitment')),

  source text not null check (source in (
    'search_gap', 'calendar', 'coverage_gap', 'reports', 'gsc', 'recruitment'
  )),

  title text not null,
  -- Null for recruitment cards; one of the post clusters for content cards
  -- (validated in app code against POST_CLUSTERS, not here — the set lives in
  -- lib/blog.ts and a CHECK would be a second copy to keep in step).
  cluster text,
  audience text not null default 'both' check (audience in ('parents', 'tutors', 'both')),
  language text not null default 'en' check (language in ('en', 'ur')),

  -- priority = demand x rankProximity x seasonality x gapAge. The components are
  -- stored so the number can be explained on the card, never as a bare score.
  priority numeric not null default 0,
  priority_components jsonb not null default '{}',

  -- evidence: the plain-word lines shown on the card ("40 searches, 0 tutors").
  -- evidence_key: the structured figures behind them, for the material-change
  -- test. evidence_hash: a COARSE, bucketed hash of evidence_key, so a dismissed
  -- topic returns only when its evidence changes materially, not on every wobble.
  evidence jsonb not null default '[]',
  evidence_key jsonb not null default '{}',
  evidence_hash text not null default '',

  status text not null default 'suggested' check (status in (
    'suggested', 'snoozed', 'dismissed', 'drafted'
  )),
  dismiss_reason text,
  snooze_until timestamptz,

  -- The editor fact-notes this suggestion pre-fills (part 2 writes the draft
  -- from them). Stored so "Generate draft" needs only the suggestion id.
  notes text,
  -- Set when a post is first saved from this suggestion, so it leaves the queue.
  drafted_post_id uuid references public.posts(id) on delete set null,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_suggestions_status_idx
  on public.content_suggestions (status, priority desc);
create index if not exists content_suggestions_card_idx
  on public.content_suggestions (card, status);

alter table public.content_suggestions enable row level security;

do $$
begin
  -- Admins read; nobody writes through a browser key. is_admin() is false for
  -- anon, so the anon key sees nothing here.
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'content_suggestions'
                   and policyname = 'content_suggestions_admin_read') then
    create policy content_suggestions_admin_read on public.content_suggestions
      for select using (public.is_admin());
  end if;
end $$;
