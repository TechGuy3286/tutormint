-- 66_rating_repair.sql — stored tutor ratings that were never earned.
--
-- NO SCHEMA CHANGE. A data repair, in the ledger so it is reviewable and
-- re-runnable rather than a set of ad-hoc UPDATEs. Idempotent: a second run
-- changes nothing.
--
-- WHY. The preview "launching soon" banner — the only thing marking the public
-- directory as examples — was removed, and the site is indexed. Several seed
-- tutors carried a rating_avg (4.3–4.9) and a rating_count (up to 27) that no
-- review row backs: 47 fabricated review counts across the directory against 3
-- real review rows in the whole database. A rating a parent reads as aggregated
-- proof, with nothing behind it, breaks the platform's hard guardrail — no
-- invented facts, no made-up statistics or reviews.
--
-- THE FIX IS COMPUTED, NOT AN EMAIL LIST. rating_avg/rating_count are normally
-- maintained by the recompute_tutor_rating() trigger from the reviews table.
-- This is the same computation applied in bulk: every tutor's stored figures
-- are set to what their actual review rows say, so a rating survives ONLY where
-- real rows exist (usman 4.50/2, sara 5.00/1 — the 3 real rows) and every
-- fabricated count falls to 0/0, which the card and profile already render as
-- "New tutor" / "No reviews yet". It cannot touch a genuinely-rated tutor,
-- because their stored value already equals the computed one.
--
-- NOTHING IS DELETED AND NO ACCOUNT IS DEACTIVATED. The directory stays
-- populated; these rows just stop asserting a rating nobody gave.

update public.tutor_profiles tp
set rating_avg = coalesce(
      (select round(avg(r.rating)::numeric, 2)
         from public.reviews r
        where r.tutor_id = tp.id and r.rating is not null),
      0),
    rating_count = coalesce(
      (select count(*)
         from public.reviews r
        where r.tutor_id = tp.id and r.rating is not null),
      0)
where tp.rating_avg is distinct from coalesce(
        (select round(avg(r.rating)::numeric, 2)
           from public.reviews r
          where r.tutor_id = tp.id and r.rating is not null),
        0)
   or tp.rating_count is distinct from coalesce(
        (select count(*)
           from public.reviews r
          where r.tutor_id = tp.id and r.rating is not null),
        0);
