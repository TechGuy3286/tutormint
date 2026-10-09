-- 158_document_member_writes.sql  (owner, 9 Oct 2026)
--
-- Members can no longer insert or delete CNIC / selfie rows themselves, nor
-- overwrite identity-docs CNIC/selfie objects: those writes go through
-- /api/documents/upload (service role), which enforces the approved-document
-- lock (migration 157). Degree rows keep the member's own insert/delete exactly
-- as before. Applied AFTER the code that inserts CNIC/selfie rows through the
-- service role is live — before that, this would refuse every member upload.

drop policy if exists user_documents_owner_write on public.user_documents;
create policy user_documents_owner_write on public.user_documents
  for insert with check (user_id = auth.uid() and kind = 'degree');

drop policy if exists user_documents_owner_delete on public.user_documents;
create policy user_documents_owner_delete on public.user_documents
  for delete using ((user_id = auth.uid() and kind = 'degree') or public.is_admin_writer());

drop policy if exists identity_docs_owner_update on storage.objects;
create policy identity_docs_owner_update on storage.objects
  for update using (
    bucket_id = 'identity-docs' and owner = auth.uid()
    and coalesce((storage.foldername(name))[2], '') not in ('cnic', 'selfie')
  );

-- The profile photo is NOT locked (owner, 9 Oct 2026): a member may change an
-- approved photo; the change goes back to photo review (the
-- profiles_photo_rereview trigger, migration 157) while the badge stays.
-- lock_tutor_profile_fields loses its avatar block and keeps the city lock.
create or replace function public.lock_tutor_profile_fields()
returns trigger
language plpgsql
as $function$
  begin
    if public.tm_member_self_edit() then
      if new.city is distinct from old.city and public.tutor_step1_complete(old.id) then
        raise exception 'This field is locked. To change it, please contact support.' using errcode = 'TMLCK';
      end if;
    end if;
    return new;
  end $function$;
