-- 46: clear the credentials the tutor settings page fabricated.
--
-- The settings page initialised its client state with sample content -- an
-- "MS Mathematics — LUMS" degree and a "Cambridge Certified Educator"
-- certificate -- and the loader only overwrote a list when the tutor's own row
-- already had one. A tutor with none kept the sample, and the next Save wrote
-- it to their profile as if they had entered it. On a platform that sells
-- degree-verified tutors, that is a fabricated credential attributed to a real
-- person. The client bug was fixed on 4 Sep 2026 (empty defaults, unconditional
-- load); this repairs the rows it already wrote.
--
-- Scoped by the EXACT fabricated strings, so a genuinely typed credential can
-- never match. Idempotent: a second run matches nothing.
--
-- Completion is deliberately not touched here. certifications is not a
-- checklist item, and the LUMS degree never counted -- the degree item needs a
-- typed degree AND an uploaded certificate document, and the one member who
-- carried the fake degree (Alishba, profile_completion 0) never uploaded one.
-- A recompute is run alongside this migration to prove the percentages are
-- unchanged rather than to change them.

-- (a) The fabricated "MS Mathematics — LUMS" degree (text[]).
update public.tutor_profiles
set degrees = array_remove(degrees, 'MS Mathematics — LUMS, Lahore (2021)')
where 'MS Mathematics — LUMS, Lahore (2021)' = any(degrees);

-- (b) The fabricated "Cambridge Certified Educator" certificate (jsonb array),
--     which carries an empty fileUrl -- no certificate was ever uploaded for it.
--     Written to three tutors by the same bug; keep every other entry.
update public.tutor_profiles
set certifications = coalesce(
      (select jsonb_agg(e)
         from jsonb_array_elements(certifications) e
        where e->>'title' is distinct from 'Cambridge Certified Educator'),
      '[]'::jsonb)
where certifications @> '[{"title":"Cambridge Certified Educator"}]'::jsonb;
