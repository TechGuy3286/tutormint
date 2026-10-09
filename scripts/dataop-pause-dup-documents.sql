-- scripts/dataop-pause-dup-documents.sql  (PR106-H3 §1.4, owner-approved;
-- CORRECTED 9 Oct 2026)
--
-- Keep ONLY the newest upload of each SIDE active and PAUSE the older
-- duplicates of that same side. Files and rows are kept — status flips to
-- 'paused' so the read paths (which filter status='active') stop showing them.
--
-- A side is: CNIC front, CNIC back (label 'back'; any other label, including
-- null, is the front), and the selfie. The first version grouped by (user_id,
-- kind) — keeping the newest CNIC photo per MEMBER — which hid the front of
-- most cards behind a newer back (scripts/report-hidden-cnic-sides.ts,
-- repaired by scripts/restore-hidden-cnic-sides.ts). Degree rows are never
-- de-duplicated: a tutor has several real degrees.
--
-- The same rule, in TypeScript and unit-tested: lib/docLockCore.ts
-- duplicatesToHide(). Idempotent: once each side has one active row, re-running
-- pauses nothing. "Newest" = max(created_at), tie-broken by id.

update public.user_documents d
   set status = 'paused'
 where d.status = 'active'
   and d.kind in ('cnic', 'selfie')
   and exists (
     select 1 from public.user_documents d2
      where d2.user_id = d.user_id
        and d2.kind = d.kind
        and d2.status = 'active'
        and (d.kind <> 'cnic'
             or (case when d2.label = 'back' then 'back' else 'front' end)
              = (case when d.label = 'back' then 'back' else 'front' end))
        and (d2.created_at > d.created_at
             or (d2.created_at = d.created_at and d2.id > d.id))
   );
