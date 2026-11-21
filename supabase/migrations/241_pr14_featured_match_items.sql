-- 241 — tutor Featured: "Matched tuitions on your WhatsApp" (owner, 21 Nov 2026 — PR-14).
--
-- Once a Pakistan day, every active tutor Featured plan holder gets ONE item in
-- People → WhatsApp updates → Today ("Featured — matched tuitions"): up to 5
-- open tuitions posted in the last 24 hours that match them. Staff send it by
-- hand (Send opens WhatsApp with the message ready; Undo the same day).
--
-- The items live in their own table, NOT in whatsapp_update_sends, so they never
-- count toward the per-tutor caps (one a day, two a Pakistan week — the partial
-- unique index there) or the 50-unpaid-a-day cap, exactly as the owner asked.
--
-- featured_match_items
--   tutor_id, pk_day   one item per tutor per Pakistan day (unique)
--   job_ids            the tuitions the item lists (ids only, newest first, ≤ 5)
--   assignee_id        the tutor's city owner, else the Owner (like other rows)
--   sent_at/by/name    the last Send (staff name for "Sent by …")
--   undone_at/by       an Undo; a later Send clears it (the audit log keeps both)
--
-- Additive and re-runnable. Ids, dates and a staff name only — never a phone,
-- email or message text. RLS on, no policy, no client grant (service role only).

create table if not exists public.featured_match_items (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles(id),
  pk_day date not null,
  job_ids uuid[] not null default '{}',
  assignee_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references public.profiles(id),
  sent_by_name text,
  undone_at timestamptz,
  undone_by uuid references public.profiles(id)
);

create unique index if not exists featured_match_items_one_a_day on public.featured_match_items (tutor_id, pk_day);
create index if not exists featured_match_items_day_idx on public.featured_match_items (pk_day desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'featured_match_items_jobs_chk') then
    alter table public.featured_match_items add constraint featured_match_items_jobs_chk check (cardinality(job_ids) between 1 and 5);
  end if;
end $$;

comment on table public.featured_match_items is
  'PR-14: one "Featured — matched tuitions" WhatsApp item per Featured tutor per Pakistan day (1–5 tuitions). Not counted in the WhatsApp updates caps. Service role only.';

alter table public.featured_match_items enable row level security;
revoke all on public.featured_match_items from anon, authenticated;
