# Region migration — Sydney → Mumbai (5 Sep 2026)

Production Supabase moved from **Sydney `flhiraqouizzwnasuraj` (ap-southeast-2)** to **Mumbai `yhekiqtelsictqkfxrfj` (ap-south-1)**, and Vercel functions to `bom1`. Sydney is retained, untouched, until the owner deletes it.

Postgres 17.6 → 17.6 (major 17 = 17). Dumped with the Supabase CLI (roles + schema + data); restored roles → schema → data (`session_replication_role=replica`) → storage policies → publication/grant re-apply. Dump checksums are in `supabase/backups/region-migration/MANIFEST.md` (the dumps themselves are git-ignored — they hold CNICs, phone numbers and password hashes).

## Row counts — every table in public / auth / storage

| schema.table | Sydney | Mumbai | match |
| --- | ---: | ---: | :---: |
| auth.audit_log_entries | 0 | 0 | OK |
| auth.custom_oauth_providers | 0 | 0 | OK |
| auth.flow_state | 7 | 7 | OK |
| auth.identities | 48 | 48 | OK |
| auth.instances | 0 | 0 | OK |
| auth.mfa_amr_claims | 389 | 389 | OK |
| auth.mfa_challenges | 0 | 0 | OK |
| auth.mfa_factors | 0 | 0 | OK |
| auth.oauth_authorizations | 0 | 0 | OK |
| auth.oauth_client_states | 0 | 0 | OK |
| auth.oauth_clients | 0 | 0 | OK |
| auth.oauth_consents | 0 | 0 | OK |
| auth.one_time_tokens | 1 | 1 | OK |
| auth.refresh_tokens | 410 | 410 | OK |
| auth.saml_providers | 0 | 0 | OK |
| auth.saml_relay_states | 0 | 0 | OK |
| auth.schema_migrations | 77 | 77 | OK |
| auth.sessions | 389 | 389 | OK |
| auth.sso_domains | 0 | 0 | OK |
| auth.sso_providers | 0 | 0 | OK |
| auth.users | 50 | 50 | OK |
| auth.webauthn_challenges | 0 | 0 | OK |
| auth.webauthn_credentials | 0 | 0 | OK |
| public._t1_degrees_unconverted | 1 | 1 | OK |
| public._t1_unmatched_subjects | 6 | 6 | OK |
| public._t1_unmigrated_messages | 3 | 3 | OK |
| public._t1_unmigrated_rows | 4 | 4 | OK |
| public._t2_remapped_subjects | 19 | 19 | OK |
| public.academy_affiliations | 0 | 0 | OK |
| public.ad_events | 11 | 11 | OK |
| public.admin_audit_log | 67 | 67 | OK |
| public.advertisements | 1 | 1 | OK |
| public.anon_search_events | 13 | 13 | OK |
| public.app_settings | 8 | 8 | OK |
| public.applications | 10 | 10 | OK |
| public.children | 3 | 3 | OK |
| public.content_suggestions | 1 | 1 | OK |
| public.demo_feedback | 1 | 1 | OK |
| public.demo_requests | 2 | 2 | OK |
| public.job_subjects | 47 | 47 | OK |
| public.jobs | 60 | 60 | OK |
| public.legacy_job_messages | 0 | 0 | OK |
| public.legacy_parent_jobs | 47 | 47 | OK |
| public.legacy_parent_profiles | 2 | 2 | OK |
| public.legacy_parents | 2 | 2 | OK |
| public.legacy_tuition_applications | 1 | 1 | OK |
| public.legacy_tuitions | 0 | 0 | OK |
| public.legacy_tutor_activities | 0 | 0 | OK |
| public.legacy_tutor_applications | 0 | 0 | OK |
| public.legacy_tutor_trust_fees | 0 | 0 | OK |
| public.legacy_tutors | 5 | 5 | OK |
| public.message_reports | 1 | 1 | OK |
| public.messages | 18 | 18 | OK |
| public.notifications | 66 | 66 | OK |
| public.payments | 8 | 8 | OK |
| public.penalties_log | 10 | 10 | OK |
| public.phone_otps | 5 | 5 | OK |
| public.plans | 5 | 5 | OK |
| public.post_revisions | 0 | 0 | OK |
| public.posts | 0 | 0 | OK |
| public.profile_views | 116 | 116 | OK |
| public.profiles | 30 | 30 | OK |
| public.rate_limits | 188 | 188 | OK |
| public.reports | 5 | 5 | OK |
| public.reviews | 3 | 3 | OK |
| public.shortlists | 0 | 0 | OK |
| public.slug_history | 11 | 11 | OK |
| public.subscriptions | 15 | 15 | OK |
| public.taxonomy_aliases | 31 | 31 | OK |
| public.taxonomy_categories | 13 | 13 | OK |
| public.taxonomy_levels | 133 | 133 | OK |
| public.taxonomy_master | 896 | 896 | OK |
| public.taxonomy_subjects | 363 | 363 | OK |
| public.threads | 8 | 8 | OK |
| public.tutor_profiles | 17 | 17 | OK |
| public.tutor_quick_replies | 0 | 0 | OK |
| public.tutor_rank_snapshots | 1 | 1 | OK |
| public.tutor_slots | 0 | 0 | OK |
| public.tutor_subjects | 17 | 17 | OK |
| public.usage_counters | 8 | 8 | OK |
| public.user_activity_log | 562 | 562 | OK |
| public.user_blocks | 0 | 0 | OK |
| public.user_documents | 15 | 15 | OK |
| storage.buckets | 7 | 7 | OK |
| storage.buckets_analytics | 0 | 0 | OK |
| storage.buckets_vectors | 0 | 0 | OK |
| storage.migrations | 65 | 65 | OK |
| storage.objects | 123 | 123 | OK |
| storage.s3_multipart_uploads | 0 | 0 | OK |
| storage.s3_multipart_uploads_parts | 0 | 0 | OK |
| storage.vector_indexes | 0 | 0 | OK |
| **total (91 tables)** | **4425** | **4425** | OK |

## Storage buckets — objects, bytes, privacy

| bucket | public | Sydney obj / bytes | Mumbai obj / bytes | match |
| --- | :---: | ---: | ---: | :---: |
| ads | public | 1 / 2214911 | 1 / 2214911 | OK |
| avatars | public | 20 / 508339 | 20 / 508339 | OK |
| blog | public | 5 / 326920 | 5 / 326920 | OK |
| identity-docs | private | 82 / 543070 | 82 / 543070 | OK |
| message-media | private | 0 / 0 | 0 / 0 | OK |
| payment-proofs | private | 2 / 140 | 2 / 140 | OK |
| tutor-media | public | 13 / 11773140 | 13 / 11773140 | OK |
| **total** | | **123 / 15366520** | **123 / 15366520** | OK |

Byte content verified: 123/123 objects copied, a 5% SHA-256 sample byte-identical, and the full owner+mimetype+cacheControl+size fingerprint identical (identity-docs owner-based RLS intact). Private buckets (identity-docs, message-media, payment-proofs) stay private with identical policies.

## Policies, publication, extensions, schema

- RLS policies: 112 (public 92 + storage 20) — identical; `rls:audit` against Mumbai **168/168**.
- Realtime publication `supabase_realtime`: `public.legacy_tuitions`, `public.notifications` — identical.
- Extensions: pg_stat_statements, pg_trgm, pgcrypto, supabase_vault, uuid-ossp (+ built-in plpgsql) — carried by schema.sql.
- Schema structural diff (977 columns across public/auth/storage): **0 differences** — migrations 01–55 fully embodied (Sydney never used a `supabase_migrations` table, so schema equality is the record).

## What the dumps could not carry, and how it was re-applied

- **Storage RLS policies** (20, `storage` schema): the CLI schema dump is public-only; regenerated from Sydney's `pg_policies` and applied (`reapply-storage-policies.sql`).
- **`tutor_visible_profiles` grant**: Supabase default privileges re-granted anon/authenticated on the view at CREATE time (Sydney had revoked them; pg_dump emits no REVOKE for an absent grant). Re-revoked to match Sydney (`reapply-post.sql`). This was the single real mismatch `rls:audit` caught — fixed to parity, then 168/168.
- **Realtime publication membership**: carried by schema.sql; `reapply-post.sql` is an idempotent backstop.
- **Roles**: the final `GRANT SET ON PARAMETER log_min_messages` (managed, needs superuser) could not apply and is already default on Mumbai; the 3 app statement-timeouts applied.
- **Auth SMTP block**: `smtp_pass` is API-redacted, so the entire custom-SMTP block (Resend host/port/user/sender/admin + password) and `rate_limit_email_sent` are an owner-by-hand step in the Mumbai dashboard → Auth → SMTP. Every other auth setting (site URL, redirect allow-list, confirm-email, all branded subjects + HTML templates, OTP/password/session/refresh/rate limits) copied identically; `custom_oauth_max_providers` differs harmlessly (custom OAuth disabled on both).

## Latency (median server-side query, warm)

- Sydney (pre-flight baseline): **465.375 ms**
- Mumbai (post-cutover): **115.6 ms** median (min 79, max 204), vs Sydney **372.3 ms** measured at the same time — **~3.2× faster** from this operator's location (Pakistan is far closer to Mumbai than to Sydney). Vercel functions run in `bom1` (Mumbai), co-located with the database.

## Rollback — env-only (Sydney is untouched)

Set these Vercel **Production** environment variables back to Sydney, then `vercel redeploy <latest-preview-url> --target production` (never `vercel promote`):

```
NEXT_PUBLIC_SUPABASE_URL       = https://flhiraqouizzwnasuraj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  = <Sydney anon key>
SUPABASE_SERVICE_ROLE_KEY      = <Sydney service_role key>
SUPABASE_DB_URL                = <Sydney session-pooler URL>
```
The env revert alone restores the Sydney data path. Reverting the code commit (which flips `scripts/target.ts`, `scripts/backup.sh` and `vercel.json` `regions`) is optional and only affects scripts/function placement, not the live data path.
