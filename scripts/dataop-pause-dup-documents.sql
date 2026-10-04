-- scripts/dataop-pause-dup-documents.sql  (PR106-H3 §1.4, owner-approved)
--
-- For each (user_id, kind), keep ONLY the latest upload active and PAUSE the
-- rest. Files and rows are kept — status flips to 'paused' so the read paths
-- (which now filter status='active') stop showing the duplicates. Idempotent:
-- re-running pauses nothing new once the latest-per-group is the only active row.
-- "Latest" = max(created_at), tie-broken by id, so exactly one stays active.

update public.user_documents d
   set status = 'paused'
 where d.status = 'active'
   and exists (
     select 1 from public.user_documents d2
      where d2.user_id = d.user_id
        and d2.kind = d.kind
        and d2.status = 'active'
        and (d2.created_at > d.created_at
             or (d2.created_at = d.created_at and d2.id > d.id))
   );
