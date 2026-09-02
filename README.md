# TutorMint

TutorMint (tutormint.org) connects verified tutors with parents and with school
and academy owners in Pakistan: verified home tutoring and online teaching,
nationwide. Revenue is memberships only — no commissions, no per-lead fees, no
middleman.

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth,
Storage) · Vercel · YouTube Data API for tutor verification videos.

`CLAUDE.md` is the specification and the working rules; `docs/STATE.md` records
what is actually built as against what that document claims.

## Getting Started

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Requires a `.env.local` — copy `.env.example`, which lists every variable the
code reads and what breaks without each one.

## History

This repository was rebuilt onto Supabase. An earlier version of the platform
ran on MongoDB with Mongoose, a multi-step wizard at `/tutor/register` posting
to an `/api/tutor/register` route, and a brand red of `#B3191F`. **None of that
is current**, and rule 1 of `CLAUDE.md` is that Supabase is the only backend and
Mongo is never re-added. The brand palette is now defined once in
`app/globals.css` and enforced by `npm run check:contrast`.

That history was described in a file called `Dev Manual tutormint.md`, which
presented the Mongo architecture as the current state and so had become
actively misleading. It was removed in T0 and remains in git history if the
narrative is ever wanted.

## Dev seed

`npm run seed:dev` populates the development database with a fixed cast for
manual testing: 6 tutors (featured / premium / verified / free / incomplete /
suspended), 4 parents (unverified / verified / featured / hired), 5 jobs, 4
applications, a thread whose message contains a phone number (for the number
masking work), a pending demo request, subscriptions including one expiring in
2 days, and profile views.

All seed accounts use the password `Test1234!` and emails of the form
`seed+<name>@tutormint.dev`, e.g. `seed+featured-ali@tutormint.dev`.

The script is idempotent: each run first deletes exactly the `seed+*` users,
and FK cascades from `auth.users` remove their data. Nothing else is touched.

**It refuses to run** unless `NODE_ENV` is not `production` **and** both
`SUPABASE_DB_URL` and `NEXT_PUBLIC_SUPABASE_URL` point at the known dev
project ref. This is what stops it ever reaching another project's data.

It requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Email confirmation
is on and the project has no SMTP sender configured, so `auth.signUp()` fails
with "Error sending confirmation email"; the seed instead uses
`auth.admin.createUser({ email_confirm: true })`, which creates confirmed
users without sending mail. The key is **server-only** — never give it a
`NEXT_PUBLIC_` prefix and never import it into client code.

## Checks

```bash
npm run verify:schema   # the T1–T7 schema is intact (34 checks)
npm run rls:audit       # nothing outside the allowlist is anonymously readable or writable
npm run check           # tsc --noEmit && next build
```

`rls:audit` is the one to run after any migration. It probes reads live with the
publishable key — the same key that is in every browser bundle — and checks
write policies structurally against `pg_policies`. Writes are deliberately not
probed: a live write probe works fine until the day the audit has something to
catch, and that is the day you least want the test suite inserting rows.

## Backups

```bash
./scripts/backup.sh            # public schema + data
./scripts/backup.sh --schema   # schema only
./scripts/backup.sh --full     # every schema, including auth.users
```

Output lands in `supabase/backups/`, date-stamped, keeping the eight most recent
of each kind. **That directory is in `.gitignore` and must stay there: a dump
contains CNIC numbers, phone numbers and home addresses.** Do not email one, do
not put one in shared cloud storage unencrypted.

Run `--full` weekly. That is the copy that survives losing access to the
Supabase account itself, which is the one failure Supabase's own automated
backups cannot cover.

To schedule it on Windows, in an elevated PowerShell:

```powershell
$action  = New-ScheduledTaskAction -Execute "C:\Program Files\Git\bin\bash.exe" `
             -Argument "-lc './scripts/backup.sh --full'" `
             -WorkingDirectory "C:\AI\TutorMint\tutormint"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 2am
Register-ScheduledTask -TaskName "TutorMint weekly backup" -Action $action -Trigger $trigger
```

On macOS or Linux, `crontab -e`:

```
0 2 * * 0 cd /path/to/tutormint && ./scripts/backup.sh --full >> /tmp/tutormint-backup.log 2>&1
```

## Before deploying

See [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) — every environment
variable Vercel needs, which are required and which merely degrade a feature,
the Supabase dashboard settings that cannot be set from this repo, and what is
still open.
