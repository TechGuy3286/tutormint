-- 07_storage.sql
-- Storage buckets and their access policies.
--   avatars        public  — profile pictures, world-readable
--   identity-docs  private — CNIC scans; owner + admin read only, never public
-- Idempotent: buckets upsert on id, policies are created only when absent.
-- CREATE/INSERT only — no drops.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('identity-docs', 'identity-docs', false)
on conflict (id) do update set public = excluded.public;

-- avatars ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'avatars_public_read') then
    create policy avatars_public_read on storage.objects
      for select using (bucket_id = 'avatars');
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'avatars_owner_write') then
    create policy avatars_owner_write on storage.objects
      for insert with check (
        bucket_id = 'avatars' and owner = auth.uid()
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'avatars_owner_update') then
    create policy avatars_owner_update on storage.objects
      for update using (bucket_id = 'avatars' and owner = auth.uid());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'avatars_owner_delete') then
    create policy avatars_owner_delete on storage.objects
      for delete using (bucket_id = 'avatars' and owner = auth.uid());
  end if;

  -- identity-docs ----------------------------------------------------------
  -- Read: the owner, or an admin. No public policy exists, so anon sees nothing.
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'identity_docs_owner_admin_read') then
    create policy identity_docs_owner_admin_read on storage.objects
      for select using (
        bucket_id = 'identity-docs'
        and (
          owner = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
          )
        )
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'identity_docs_owner_write') then
    create policy identity_docs_owner_write on storage.objects
      for insert with check (
        bucket_id = 'identity-docs' and owner = auth.uid()
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'identity_docs_owner_update') then
    create policy identity_docs_owner_update on storage.objects
      for update using (bucket_id = 'identity-docs' and owner = auth.uid());
  end if;
end $$;
