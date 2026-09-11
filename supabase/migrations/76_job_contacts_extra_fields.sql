-- 76_job_contacts_extra_fields.sql
--
-- More contact fields for admin-posted (seeded) tuitions (owner, 11 Sep 2026).
--
-- Admin copies tuitions from public hiring ads — school and academy Facebook
-- posts, WhatsApp statuses — where the poster's details are the institution's
-- own, openly published, not a private household's. Alongside the existing name
-- and phone, the admin form can now record a WhatsApp number, an email, an
-- address and a social handle.
--
-- ALL of these go here, in job_contacts, NEVER on the jobs row. `jobs` has a
-- public row-read policy and RLS controls rows, not columns, so anything on the
-- jobs row is one select('*') away from a public, indexed page. That is the
-- whole reason name and phone already live here (migration 65). These four are
-- the same class of data and follow the same rule: service-role write, admin
-- read, shown to signed-in tutors only, never in metadata / JSON-LD / OG / the
-- sitemap, never to another parent.
--
-- Additive only. No RLS change — the same table, the same admin-read policy and
-- service-role writes already cover the new columns.

alter table public.job_contacts
  add column if not exists contact_whatsapp text,
  add column if not exists contact_email    text,
  add column if not exists contact_address  text,
  add column if not exists contact_social   text;
