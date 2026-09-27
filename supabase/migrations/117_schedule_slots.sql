-- 117_schedule_slots.sql  (PR73 §A)
--
-- Structured schedule for a tuition: a jsonb list of {day, slot} pairs, the same
-- three-band model (Morning / Afternoon / Evening) the tutor availability grid
-- uses. Additive. The old free-text `jobs.timings` column stays and is kept in
-- sync with the short display form ("Mon, Tue: Evening · Sat: Morning") by the
-- write paths and the backfill, so anything still reading it works.
--
-- Tutors reuse the existing tutor_profiles.availability_list (text[]) with a
-- slot-label shape ({day, timeSlot:"Evening"}), so they need no new column.
--
-- The free-text → slot backfill (parsing the real timings/availability values)
-- runs in scripts/backfill-slots.ts AFTER this migration, using lib/timeSlots so
-- the SQL and the app parse one way.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS schedule_slots jsonb;

COMMENT ON COLUMN public.jobs.schedule_slots IS
  'PR73: structured schedule [{day,slot}] (Morning/Afternoon/Evening). timings holds the display text.';
