-- 61_reset_verified_empty_tutors.sql
--
-- Three tutors carried verification_status='verified' at 0% completion with no
-- profile data — verified-but-empty (flagged in the 9 Sep report, owner
-- confirmed the reset). Two are real people who should go through verification
-- properly; the third is a test account. Reset all three to 'pending' so they
-- re-verify the normal way. Scoped by email, idempotent (only touches rows that
-- are still 'verified').
--
--   aliasgharg172@gmail.com      (real)
--   alisabeer3286@gmail.com      (real)
--   dummy.tutor@tutormint.org    (test)

begin;

update public.tutor_profiles
set verification_status = 'pending'::verification_status
where verification_status = 'verified'
  and id in (
    select id from public.profiles
    where email in (
      'aliasgharg172@gmail.com',
      'alisabeer3286@gmail.com',
      'dummy.tutor@tutormint.org'
    )
  );

commit;
