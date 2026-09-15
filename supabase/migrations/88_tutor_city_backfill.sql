-- 88_tutor_city_backfill.sql
--
-- ONE CITY FIELD FOR TUTORS (owner, PR 3b §0).
--
-- The tutor forms (complete-profile, onboarding) wrote the tutor's city to
-- profiles.city, but the listing rule (tutor_directory / directoryBlockers) reads
-- tutor_profiles.city — so a tutor who entered a city ("Lahore") stayed
-- "not shown to parents" with tutor_profiles.city NULL. The application code is
-- fixed to write tutor_profiles.city and mirror it into profiles.city.
--
-- This migration backfills the tutors already caught by the old split: where the
-- tutor entered a city (profiles.city is set) but tutor_profiles.city is empty,
-- copy the tutor's OWN entered value across. It touches only tutor rows with a
-- genuinely empty tutor_profiles.city, so nothing that already has a directory
-- city is changed. Idempotent — re-running it copies nothing new.
--
-- Observed before this ran (production): 4 tutors would be backfilled
-- (tp.city empty AND profiles.city set), including Stella Luis.

begin;

update tutor_profiles tp
set city = btrim(p.city)
from profiles p
where p.id = tp.id
  and p.role = 'tutor'
  and (tp.city is null or btrim(tp.city) = '')
  and p.city is not null
  and btrim(p.city) <> '';

commit;
