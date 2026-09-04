# Seed cast — the named test accounts

The demo/test accounts on the one Supabase project (which serves both preview
and production). Each is named for the role and plan it is meant to demonstrate,
so an evidence screenshot lands on the right kind of account. The canonical
definition lives in [`scripts/seedCast.ts`](../scripts/seedCast.ts); this file
is the human-readable copy, kept in step by hand.

**Password for every seed account: `Test1234!`**

## The cast

| Account | Role | Plan | Listed | Intent |
|---|---|---|---|---|
| `seed+featured-ali@tutormint.dev` | tutor | Featured (active) | yes | All three badges — Verified, Premium, Featured. |
| `seed+premium-sara@tutormint.dev` | tutor | Premium (active) | yes | Verified + Premium badges. |
| `seed+verified-usman@tutormint.dev` | tutor | Verified (active) | yes | Verified badge only. |
| `seed+free-nadia@tutormint.dev` | tutor | none | yes (100%) | Free tutor, listed, **no badge**. The 199 funnel's target. |
| `seed+free-hina@tutormint.dev` | tutor | none | yes (100%) | Free tutor, no plan. |
| `seed+suspended-omar@tutormint.dev` | tutor | none | no | Suspended — every power off, delisted. |
| `seed+featured-ayesha@tutormint.dev` | parent | parent_featured (active) | — | Featured parent: can hire, sees contact. |
| `seed+verified-fatima@tutormint.dev` | parent | none (free verified tier) | — | Verified parent (CNIC + address approved), **no paid plan**. |
| `seed+unverified-zain@tutormint.dev` | parent | none | — | Unverified parent — browse only. |

Accounts **not** part of the cast and left alone by the reset:
`seed+manager`, `seed+verifier`, `seed+finance`, `seed+support` (admin staff),
`seed+incomplete-bilal` (a 46% tutor fixture), `seed+verified-kamran` (a second
verified parent).

## Keeping it true

The cast drifts whenever an evidence run flips an account to a plan to
photograph a surface and forgets — or restores to the wrong baseline. On
4 Sep 2026 five of nine had drifted: two free tutors carried Premium, the
Premium and Verified tutors were both on Featured, the "verified, no plan"
parent held parent_featured, and the "unverified" parent had a verified CNIC.

Two guards keep it honest:

- **`npx tsx scripts/reset-seed-cast.ts`** reports the drift; add `--apply` to
  put every account back to the table above. Idempotent — a clean cast reports
  nothing to do. It never writes `profile_completion` (that is derived; a cast
  member below its expected completion is a real content gap, warned not
  papered over).
- **`npx tsx scripts/smoke.ts`** creates one tutor and one parent, then asserts
  the cast is byte-for-byte unchanged. The rule this enforces: *any evidence
  step that changes a seed account's plan, status or completion restores it in
  the same run and asserts the restore.*
