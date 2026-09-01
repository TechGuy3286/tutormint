# TutorMint — production launch checklist

Everything that has to be true before `rebuild` reaches `main`. Written at T8a;
tick items as they are done, and leave the notes in place — a checklist whose
reasons have been deleted is a list of chores nobody can question.

`main` is live at tutormint.org. **Nothing in this file is done automatically.**

---

## 1. Environment variables on Vercel

Set these in the Vercel project (Production, and Preview where noted). Required
means the platform is broken without it; optional means a feature degrades and
says so.

### Required

| Variable | Where it is used | If missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything | nothing works |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` *(or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)* | browser + server reads | nothing works |
| `SUPABASE_SERVICE_ROLE_KEY` | admin screens, activation, moderation, notifications, rate limits | admin screens render an error; payments cannot activate; OTP cannot be issued |
| `CRON_SECRET` | `/api/cron/subscriptions` | **the sweep endpoint refuses every request**, so nothing expires and no reminders go out. Also: an unset secret on an open endpoint would be a denial-of-service switch |
| `NEXT_PUBLIC_SITE_URL` | links inside emails | links fall back to `https://tutormint.org` — correct today, wrong the moment the domain changes |

> **`SUPABASE_SERVICE_ROLE_KEY` must never be prefixed `NEXT_PUBLIC_`.** It
> bypasses every row-level security policy on the database. If it is ever
> exposed in a client bundle, rotate it in Supabase immediately — changing the
> variable is not enough, the leaked key stays valid until it is rotated.

### Required before taking money

| Variable | Notes |
|---|---|
| `ASSANPAY_BASE_URL` | All four are needed together. |
| `ASSANPAY_MERCHANT_ID` | With any one missing, `getProvider()` falls back to manual transfer — a deliberate degradation, not an error. |
| `ASSANPAY_API_KEY` | |
| `ASSANPAY_WEBHOOK_SECRET` | Fields inside `lib/payments/assanpay.ts` are marked `TODO(assanpay)` until their documentation is in hand. |
| `MANUAL_PAY_BANK_NAME` | Manual transfer is the floor and works with no gateway at all. |
| `MANUAL_PAY_ACCOUNT_TITLE` | Any of these can instead be set as `app_settings` rows (`pay.*`), which an admin changes without a deploy. |
| `MANUAL_PAY_IBAN` | A channel with no details configured is **not offered** rather than shown blank. |
| `MANUAL_PAY_JAZZCASH` | |
| `MANUAL_PAY_EASYPAISA` | |

### Optional (feature degrades, and says so)

| Variable | Without it |
|---|---|
| `RESEND_API_KEY` | **No email is sent at all** in production, and `instrumentation.ts` warns at startup. Development prints messages to the log instead. The sending domain must be verified in Resend first. |
| `MAIL_FROM` | Defaults to `TutorMint <noreply@tutormint.org>`. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` *(or `TWILIO_MESSAGING_SERVICE_SID`)* | Phone OTP codes cannot be delivered, so nobody can verify a number, so no parent can be verified and no import can be claimed. Enable Pakistan in Twilio's geographic permissions — that is an account setting, not code. |
| `YOUTUBE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` / `_REFRESH_TOKEN` | Video visibility changes are recorded on the profile but not applied on YouTube, and the response says so in words. |
| `SUPPORT_WHATSAPP` / `SUPPORT_EMAIL` / `SUPPORT_HOURS` | `/support` shows the FAQ with no contact buttons. Can be set as `app_settings` rows (`support.*`) instead. |
| `SUPABASE_DB_URL` | Scripts only (`seed:dev`, `verify:schema`, `rls:audit`, `backup.sh`). The app never uses it. |

---

## 1b. Preview environment

Vercel builds a preview deployment with `next build`, so **`NODE_ENV` is
`production` there** — identically to the live site. Anything gated on
`NODE_ENV` therefore switches off on preview, which would hand a tester a real
card gateway and a real SMS bill.

`lib/env.ts` asks `VERCEL_ENV` instead, falling back to `NODE_ENV` only for
local builds. Set variables **per environment** in Vercel — Project → Settings →
Environment Variables has a Production / Preview / Development checkbox on every
one.

### What preview relaxes, and what it does not

| Relaxed on Preview | Never relaxed, anywhere |
|---|---|
| `DEV_DEFAULT_OTP` bypass and its startup assertion | Row-level security |
| Payment simulator (`/pay/simulator/[ref]`) | Authentication and role gating |
| `/dev/*` routes | Entitlements and quotas |
| Console SMS and email adapters | Rate limits |
| `seed:dev` / `seed:cleanup` guards | Security headers and the CSP |
| | Admin permissions and re-authentication |

A preview points at the **same Supabase project with the same policies**.
Nothing in `lib/env.ts` can loosen a database rule, because no database rule
consults it.

### Preview: set these

| Variable | Value | Why |
|---|---|---|
| `DEV_DEFAULT_OTP` | e.g. `000000` | Verify a phone with no SMS provider attached. **Preview only.** |
| `PAYMENTS_SIMULATOR` | `true` | The fake gateway. **Preview only.** |
| `PAYMENTS_SIMULATOR_SECRET` | any long random string | No default exists anywhere; without it the simulator stays off, because a signature check that passes with no secret is not a check. |
| `NEXT_PUBLIC_SITE_URL` | the preview URL | Otherwise email links point at tutormint.org and a tester ends up on the live site. |
| `CRON_SECRET` | a **different** value from Production | So a leaked preview secret cannot drive the live sweep. |

Copy across from Production: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, the
`MANUAL_PAY_*` values, and `SUPPORT_*`.

Leave **unset** on Preview: `RESEND_API_KEY` and the `TWILIO_*` values, unless
you specifically want a preview sending real email and real SMS. Without them
the console adapters print to the Vercel function log, which is where a tester
should be reading the OTP from anyway.

### Production: these must NOT exist

| Variable | What happens if it does |
|---|---|
| **`DEV_DEFAULT_OTP`** | **The server refuses to start.** `assertOtpSafety()` throws in `instrumentation.ts` and the deployment fails its health check. This is deliberate: a fixed code that verifies any number is, in production, a master key to every account, and its presence means somebody expects it to work. |
| **`PAYMENTS_SIMULATOR`** / `PAYMENTS_SIMULATOR_SECRET` | The simulator stays off regardless (`isProduction()` is checked first), but leaving them set implies otherwise. Remove them. |

After deploying a preview, the function log should read
`[startup] VERCEL_ENV=preview`. If it says `VERCEL_ENV=production` on a branch
deployment, the variables are on the wrong environment.

---

## 2. Supabase project settings

These are dashboard settings, not code. None of them can be set from this repo.

- [ ] **Confirm email: ON.** Currently OFF on the dev project. With it on, the welcome email is sent from `/api/auth/callback` after the address is proven real.
- [ ] **SMTP configured**, so confirmation emails and staff invites actually send. Without it, `createStaff()` falls back to a one-time temporary password shown to the owner once — which works, but means a colleague waits for an invite that never arrives.
- [ ] **Leaked-password protection: ON** (Authentication → Policies). Rejects passwords found in known breach corpora.
- [ ] **Cloudflare Turnstile** on sign-in and sign-up (Authentication → Attack Protection). *Not built in T8a — it is a Supabase-side integration plus a widget on `/login` and `/register`.*
- [ ] **Rate limits** reviewed under Authentication → Rate Limits. Application-level limits are in `lib/rateLimit.ts`; these are Supabase's own.
- [ ] **Automated backups** confirmed on the plan in use. `scripts/backup.sh` is the copy that survives losing the Supabase account itself — not a replacement.
- [ ] **Region.** Currently Sydney. Migration to Mumbai `ap-south-1` is T8b; every request from Pakistan currently crosses the Pacific twice.

---

## 3. Database

- [ ] All migrations applied in order, `01` … `28`.
- [ ] `npm run verify:schema` — green.
- [ ] `npm run rls:audit` — green. Fails if anything outside the allowlist is anonymously readable, or a write policy exists that does not scope to a caller.
- [ ] `scripts/seed-cleanup.ts --apply` run against the dev project once the fixtures are no longer needed. It refuses to run against any project but the dev ref.
- [ ] A fresh `./scripts/backup.sh --full` taken and stored somewhere off this machine.

---

## 4. Verify in the production build

Run `npm run build && npm start` locally and check both environments. Setting
`VERCEL_ENV` on the command line is what makes this testable without deploying.

**As Production** (`VERCEL_ENV=production`, or no `VERCEL_ENV` with
`NODE_ENV=production`):

- [ ] `/dev/components` → **404**
- [ ] `/pay/simulator/anything` → **404**
- [ ] `DEV_DEFAULT_OTP` set → **the server refuses to start**, with the reason

**As Preview** (`VERCEL_ENV=preview`, `NODE_ENV=production`):

- [ ] the server **starts** with `DEV_DEFAULT_OTP` set, logging `[startup] VERCEL_ENV=preview`
- [ ] `/dev/components` → **200**
- [ ] `/pay/simulator/…` → reachable
- [ ] the security headers below are **identical** to Production
- [ ] Response headers carry `Content-Security-Policy`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`
- [ ] `/robots.txt` and `/sitemap.xml` both render, and the sitemap contains tutor slugs

---

## 5. Content and legal

- [ ] `/terms` and `/privacy` **reviewed by a Pakistani lawyer.** Both are marked as drafts in a comment at the top of their files. They deliberately cite no statute — describing our actual practice accurately is better than naming an ordinance nobody has checked. Sections worth the closest look: Terms 6 (payments and no-refund), 11 (liability), 13 (governing law).
- [ ] Support WhatsApp number and email set, and somebody is actually reading them.
- [ ] Manual payment account details confirmed correct — **check the IBAN character by character.** A wrong digit here sends members' money to a stranger.
- [ ] The no-refund policy appears on both packages pages before payment. (It does; confirm it survived any copy edit.)

---

## 6. Still open after T8a

Not done, deliberately, and each is a piece of work rather than a line of config:

- **Nonce-based CSP.** `script-src` carries `'unsafe-inline'` because Next's App Router emits inline bootstrap scripts. The reasoning is written out in `next.config.ts`. What the policy already stops is the step that turns an XSS into data exfiltration; closing the rest needs a per-request nonce threaded through `proxy.ts`, which is its own change with its own testing.
- **Cloudflare Turnstile** on `/login` and `/register`.
- **WhatsApp delivery.** `lib/notify/whatsapp.ts` is the interface with no body: it needs a Meta business account, a verified sender and approved templates, none of which is code.
- **Region migration** to Mumbai.
- **`tutor_activities` → `user_activity_log`.** Migration 28 asserts the legacy table is empty (it is), so there is nothing to move today.
- **Legacy NOT NULL columns** on `jobs` and `messages`, inherited from the pre-rebuild schema. Relaxing them needs an `ALTER COLUMN`, which is on the owner-approval list.
- **`penalties_log.job_tx_id`** was dropped in migration 27; nothing now links a penalty to a job. Wire it to `jobs.id` if that link is wanted.
