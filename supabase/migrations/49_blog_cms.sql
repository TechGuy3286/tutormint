-- 49_blog_cms.sql
-- Blog CMS, part 1 (CLAUDE.md 9.3): the editor, publishing and the public
-- pages. Additive only -- two new tables and one public bucket. Nothing
-- existing changes shape.
--
-- WRITES GO THROUGH THE SERVICE ROLE, like advertisements and notifications.
-- posts has a public SELECT policy for PUBLISHED rows (plus is_admin() so an
-- admin server component can read drafts), and no INSERT/UPDATE/DELETE policy
-- at all: every mutation is an audited admin route holding the service key.
-- That is why there is no write policy for the RLS audit to scrutinise -- there
-- is nothing a browser key can write here.
--
-- CLUSTERS ARE A FIXED SET, enforced by a CHECK so a typo cannot invent a
-- cluster the /blog index has no filter for. The slugs are mirrored in
-- lib/blog.ts (POST_CLUSTERS); the labels live only there.

-- ------------------------------------------------------------------ posts ----
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  -- Immutable after publish. The app locks the field and sets slug_locked; the
  -- column stays writable so an unpublished draft can still be renamed.
  slug text not null unique,
  slug_locked boolean not null default false,

  cluster text not null check (cluster in (
    'cost-hiring', 'boards-exams', 'subject-guides',
    'city-guides', 'tutor-career', 'safety-trust', 'urdu'
  )),
  audience text not null default 'both' check (audience in ('parents', 'tutors', 'both')),
  language text not null default 'en' check (language in ('en', 'ur')),

  -- Markdown, rendered server-side by lib/markdown.ts into a known-safe tag
  -- whitelist. Never rendered as raw HTML.
  body text not null default '',

  -- Cover image in the public `blog` bucket. cover_alt is required whenever a
  -- cover exists -- enforced in the route, because a draft may be saved with
  -- neither yet, and a NOT NULL here would block that.
  cover_path text,
  cover_alt text,

  -- SEO. Length ceilings match the editor's counters; enforced app-side so an
  -- over-long paste is trimmed with a message rather than rejected by the DB.
  seo_title text,
  seo_description text,

  -- Landing pages this post relates to, as "kind/citySlug/subjectSlug" paths.
  -- Rendered through the live landing set so a path that has since dropped
  -- below the threshold simply is not shown.
  related_landing_pages text[] not null default '{}',

  status text not null default 'draft' check (status in (
    'draft', 'reviewed', 'scheduled', 'published', 'unpublished'
  )),
  -- The human gate on Publish: at least one saved edit AND a ticked review.
  edited_by_human boolean not null default false,
  reviewed boolean not null default false,

  -- publish_at: the scheduled time for a 'scheduled' post; the cron flips it to
  -- 'published' when this passes. published_at: the FIRST time it went live, for
  -- Article datePublished -- set once and never moved by a later edit.
  publish_at timestamptz,
  published_at timestamptz,

  author_id uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,

  -- Analytics. Both incremented server-side only (service role); there is no
  -- client-writable path, which is what makes them worth reporting.
  views integer not null default 0,
  cta_clicks integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_public_idx
  on public.posts (published_at desc)
  where status = 'published';
create index if not exists posts_cluster_idx on public.posts (cluster);
-- The scheduled sweep reads exactly this.
create index if not exists posts_due_idx
  on public.posts (publish_at)
  where status = 'scheduled';

-- --------------------------------------------------------- post_revisions ----
-- One row per save, so an edit is never silently lost and a bad change can be
-- read back. Server-written, admin-read; no public exposure.
create table if not exists public.post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  title text,
  slug text,
  cluster text,
  audience text,
  language text,
  body text,
  cover_path text,
  cover_alt text,
  seo_title text,
  seo_description text,
  related_landing_pages text[],
  status text,
  editor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists post_revisions_post_idx
  on public.post_revisions (post_id, created_at desc);

-- ------------------------------------------------------------------- RLS ----
alter table public.posts enable row level security;
alter table public.post_revisions enable row level security;

do $$
begin
  -- Public reads see published posts only; an admin (any role) also sees
  -- drafts, so an admin server component reading through the cookie client
  -- works without a separate service-role read. is_admin() is false for anon,
  -- so the anon key gets published rows and nothing else.
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'posts'
                   and policyname = 'posts_public_read') then
    create policy posts_public_read on public.posts
      for select using (status = 'published' or public.is_admin());
  end if;

  -- Revisions are for admins only. No public read, no write policy.
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'post_revisions'
                   and policyname = 'post_revisions_admin_read') then
    create policy post_revisions_admin_read on public.post_revisions
      for select using (public.is_admin());
  end if;
end $$;

-- ------------------------------------------------------------ blog bucket ----
-- Cover images are marketing pictures on public pages, so the bucket is public
-- like `ads` -- and, like `ads`, only an admin may write to it.
insert into storage.buckets (id, name, public)
values ('blog', 'blog', true)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'blog_public_read') then
    create policy blog_public_read on storage.objects
      for select using (bucket_id = 'blog');
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'blog_admin_write') then
    create policy blog_admin_write on storage.objects
      for insert with check (
        bucket_id = 'blog'
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'blog_admin_update') then
    create policy blog_admin_update on storage.objects
      for update using (
        bucket_id = 'blog'
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'blog_admin_delete') then
    create policy blog_admin_delete on storage.objects
      for delete using (
        bucket_id = 'blog'
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;
end $$;

-- --------------------------------------------------------- metric counters ----
-- Atomic increment for the two analytics counters, so two concurrent views do
-- not read-modify-write over each other. Called by the server routes through
-- the service role (the only grantee); guarded on status so only a published
-- post accrues a view or a CTA click.
create or replace function public.increment_post_metric(p_id uuid, p_metric text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_metric = 'views' then
    update public.posts set views = views + 1 where id = p_id and status = 'published';
  elsif p_metric = 'cta' then
    update public.posts set cta_clicks = cta_clicks + 1 where id = p_id and status = 'published';
  end if;
end $$;

revoke all on function public.increment_post_metric(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_post_metric(uuid, text) to service_role;
