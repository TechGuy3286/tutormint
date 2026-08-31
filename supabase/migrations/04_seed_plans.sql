-- 04_seed_plans.sql
-- The five plan rows from the CLAUDE.md entitlements matrix.
-- Idempotent: upsert keyed on `code`, so re-running refreshes values in place.
-- CREATE/INSERT/UPDATE of seed data only — no drops.

insert into public.plans (
  code, audience, name, price_pkr, duration_days,
  monthly_quota, displayed_quota,
  can_view_contact, can_whatsapp, can_initiate_message,
  search_rank, badges, tag_label
) values
  -- Tutor plans -------------------------------------------------------------
  ('verified',        'tutor',  'Verified', 199, 30,
   10,  '10',
   false, false, false,           -- may only reply to messages received, and apply to jobs
   1, array['Verified'], null),

  ('premium',         'tutor',  'Premium', 499, 30,
   25,  '25',
   false, true,  true,            -- WhatsApp + may initiate messages to any parent
   2, array['Verified','Premium'], null),

  ('featured',        'tutor',  'Featured', 999, 30,
   100, 'Unlimited',              -- real cap 100; shown to the user as "Unlimited"
   true,  true,  true,
   3, array['Verified','Premium','Featured'], 'Featured'),

  -- Parent plans ------------------------------------------------------------
  ('parent_verified', 'parent', 'Verified', 0, 30,
   5,   '5',
   false, false, false,           -- reply only
   1, array['Verified'], null),

  ('parent_featured', 'parent', 'Featured', 999, 30,
   100, 'Unlimited',              -- real cap 100; shown to the user as "Unlimited"
   true,  true,  true,
   3, array['Verified','Featured'], 'Featured')

on conflict (code) do update set
  audience             = excluded.audience,
  name                 = excluded.name,
  price_pkr            = excluded.price_pkr,
  duration_days        = excluded.duration_days,
  monthly_quota        = excluded.monthly_quota,
  displayed_quota      = excluded.displayed_quota,
  can_view_contact     = excluded.can_view_contact,
  can_whatsapp         = excluded.can_whatsapp,
  can_initiate_message = excluded.can_initiate_message,
  search_rank          = excluded.search_rank,
  badges               = excluded.badges,
  tag_label            = excluded.tag_label;
