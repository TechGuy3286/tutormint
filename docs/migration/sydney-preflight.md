# Sydney pre-flight — region migration baseline

Generated 2026-09-05T15:29:53.936Z · source project `flhiraqouizzwnasuraj` (ap-southeast-2, READ-ONLY) → target `yhekiqtelsictqkfxrfj` (ap-south-1).

## Postgres
- PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
- Major version **17** — Mumbai is **17** ✓ match
- Median query latency (10× `count(*) from tutor_directory`, warm): **465.375 ms**

## Extensions (6)
| extension | version |
| --- | --- |
| pg_stat_statements | 1.11 |
| pg_trgm | 1.6 |
| pgcrypto | 1.3 |
| plpgsql | 1.0 |
| supabase_vault | 0.3.1 |
| uuid-ossp | 1.1 |

## Roles (30)
`anon`, `authenticated`, `authenticator`, `dashboard_user`, `pg_checkpoint`, `pg_create_subscription`, `pg_database_owner`, `pg_execute_server_program`, `pg_maintain`, `pg_monitor`, `pg_read_all_data`, `pg_read_all_settings`, `pg_read_all_stats`, `pg_read_server_files`, `pg_signal_backend`, `pg_stat_scan_tables`, `pg_use_reserved_connections`, `pg_write_all_data`, `pg_write_server_files`, `pgbouncer`, `postgres`, `service_role`, `supabase_admin`, `supabase_auth_admin`, `supabase_etl_admin`, `supabase_privileged_role`, `supabase_read_only_user`, `supabase_realtime_admin`, `supabase_replication_admin`, `supabase_storage_admin`

## Schemas (8)
`auth`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, `vault`

## Row counts — 4423 rows across 91 tables
Per schema: **public** 2857 · **auth** 1371 · **storage** 195

| schema | table | rows |
| --- | --- | ---: |
| auth | audit_log_entries | 0 |
| auth | custom_oauth_providers | 0 |
| auth | flow_state | 7 |
| auth | identities | 48 |
| auth | instances | 0 |
| auth | mfa_amr_claims | 389 |
| auth | mfa_challenges | 0 |
| auth | mfa_factors | 0 |
| auth | oauth_authorizations | 0 |
| auth | oauth_client_states | 0 |
| auth | oauth_clients | 0 |
| auth | oauth_consents | 0 |
| auth | one_time_tokens | 1 |
| auth | refresh_tokens | 410 |
| auth | saml_providers | 0 |
| auth | saml_relay_states | 0 |
| auth | schema_migrations | 77 |
| auth | sessions | 389 |
| auth | sso_domains | 0 |
| auth | sso_providers | 0 |
| auth | users | 50 |
| auth | webauthn_challenges | 0 |
| auth | webauthn_credentials | 0 |
| public | _t1_degrees_unconverted | 1 |
| public | _t1_unmatched_subjects | 6 |
| public | _t1_unmigrated_messages | 3 |
| public | _t1_unmigrated_rows | 4 |
| public | _t2_remapped_subjects | 19 |
| public | academy_affiliations | 0 |
| public | ad_events | 11 |
| public | admin_audit_log | 67 |
| public | advertisements | 1 |
| public | anon_search_events | 12 |
| public | app_settings | 8 |
| public | applications | 10 |
| public | children | 3 |
| public | content_suggestions | 1 |
| public | demo_feedback | 1 |
| public | demo_requests | 2 |
| public | job_subjects | 47 |
| public | jobs | 60 |
| public | legacy_job_messages | 0 |
| public | legacy_parent_jobs | 47 |
| public | legacy_parent_profiles | 2 |
| public | legacy_parents | 2 |
| public | legacy_tuition_applications | 1 |
| public | legacy_tuitions | 0 |
| public | legacy_tutor_activities | 0 |
| public | legacy_tutor_applications | 0 |
| public | legacy_tutor_trust_fees | 0 |
| public | legacy_tutors | 5 |
| public | message_reports | 1 |
| public | messages | 18 |
| public | notifications | 66 |
| public | payments | 8 |
| public | penalties_log | 10 |
| public | phone_otps | 5 |
| public | plans | 5 |
| public | post_revisions | 0 |
| public | posts | 0 |
| public | profile_views | 116 |
| public | profiles | 30 |
| public | rate_limits | 187 |
| public | reports | 5 |
| public | reviews | 3 |
| public | shortlists | 0 |
| public | slug_history | 11 |
| public | subscriptions | 15 |
| public | taxonomy_aliases | 31 |
| public | taxonomy_categories | 13 |
| public | taxonomy_levels | 133 |
| public | taxonomy_master | 896 |
| public | taxonomy_subjects | 363 |
| public | threads | 8 |
| public | tutor_profiles | 17 |
| public | tutor_quick_replies | 0 |
| public | tutor_rank_snapshots | 1 |
| public | tutor_slots | 0 |
| public | tutor_subjects | 17 |
| public | usage_counters | 8 |
| public | user_activity_log | 562 |
| public | user_blocks | 0 |
| public | user_documents | 15 |
| storage | buckets | 7 |
| storage | buckets_analytics | 0 |
| storage | buckets_vectors | 0 |
| storage | migrations | 65 |
| storage | objects | 123 |
| storage | s3_multipart_uploads | 0 |
| storage | s3_multipart_uploads_parts | 0 |
| storage | vector_indexes | 0 |

## Storage buckets (7)
| bucket | public | objects | bytes |
| --- | --- | ---: | ---: |
| ads | true | 1 | 2214911 |
| avatars | true | 20 | 508339 |
| blog | true | 5 | 326920 |
| identity-docs | false | 82 | 543070 |
| message-media | false | 0 | 0 |
| payment-proofs | false | 2 | 140 |
| tutor-media | true | 13 | 11773140 |
| **total** | | **123** | **15366520** |

## RLS
- pg_policies count: **112**

## Realtime publication `supabase_realtime` (2 tables)
`public.legacy_tuitions`, `public.notifications`

## Cron jobs (0)
_none (pg_cron not installed or no jobs)_

## Edge functions (0)
_none_
