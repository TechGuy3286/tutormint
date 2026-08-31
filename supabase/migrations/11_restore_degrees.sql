-- 11_restore_degrees.sql
-- One-off repair of the single tutor_profiles.degrees value that
-- 02b_type_changes.sql could not convert.
--
-- The jsonb -> text[] rule was "a JSON array of strings converts, anything
-- else is logged and set to {}". This row held an array of OBJECTS, so it
-- became {} and the degree text was lost from the column. The original was
-- recovered from supabase/backups/before-t1.sql:
--
--   [{"year": "2021", "title": "MS Mathematics", "fileUrl": "",
--     "fileName": "degree_ms.pdf", "institute": "LUMS, Lahore"}]
--
-- Flattened to the agreed display form: "TITLE — INSTITUTE (YEAR)".
-- fileUrl/fileName are dropped; degrees is text[] and carries no file
-- reference. The certificate file itself is unaffected.
--
-- Idempotent: only writes where degrees is still empty/null.

update public.tutor_profiles
set degrees = array['MS Mathematics — LUMS, Lahore (2021)']
where id = 'a412120a-5cb0-4ab4-9749-4f67ff67df76'
  and coalesce(array_length(degrees, 1), 0) = 0;
