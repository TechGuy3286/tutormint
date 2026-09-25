import Link from 'next/link'
import { Check, ShieldCheck } from 'lucide-react'
import BadgeRow from '@/components/badges/BadgeRow'
import FeaturedTag from '@/components/badges/FeaturedTag'
import type { BadgeName } from '@/lib/planBadges'
import BuyButton from '@/components/membership-plans/BuyButton'
import { formatDate } from '@/lib/datetime'

// The plan matrix, rendered from the `plans` table (owner PR12/§1.2).
//
// Prices, quotas and powers are read from the database rather than written
// here, so what a member is shown and what lib/entitlements.ts actually grants
// come from the same row and cannot drift. Every card's per-plan facts — its
// price, its quota, and which of the columns below it has — come from the plan
// row; the only strings in this file are the LABELS that describe a column
// (what "can_view_contact" means in words) and a tiny set of universal
// free-tier truths the plans table has no column for (browse, reply, CV).
//
// THE DELTA MODEL (owner PR13 §1.4/§1.5). The free card lists its own features;
// every paid card leads with "Everything in <free>, plus:" and lists ONLY what
// it adds over the free tier — so no free feature ever reads as missing on a
// paid card, and the additions are computed from the columns, never typed.

export type PlanRow = {
  code: string
  name: string
  price_pkr: number
  monthly_quota: number
  displayed_quota: string | null
  can_view_contact: boolean
  can_whatsapp: boolean
  can_initiate_message: boolean
  can_hire: boolean
  can_see_viewer_identity: boolean
  search_rank: number
  badges: string[] | null
  tag_label: string | null
}

// A comparable feature. `level` is a magnitude read from the plan row (a boolean
// as 0/1, a quota as its number, ranking as search_rank); a paid plan lists a
// feature when its level exceeds the free plan's, and the free card lists every
// feature whose level is above zero. `label` reads the plan's own value (so the
// quota line says "10" on Basic and "Unlimited" on Premium — from the row).
type Feature = { label: (p: PlanRow) => string; level: (p: PlanRow) => number }

const quota = (p: PlanRow) => p.displayed_quota ?? String(p.monthly_quota)
const isUnlimited = (p: PlanRow) => (p.displayed_quota ?? '').toLowerCase() === 'unlimited'

// The DELTA features a paid card shows over the free tier. The quota line reads
// "Unlimited applications / tuition posts" when the plan is unlimited (owner
// PR14 §4.2), and the number from the row otherwise.
// The order here IS the order the paid cards render (the delta filter keeps a
// feature when its level exceeds Basic's, in array order). It yields exactly the
// approved sheet: Premium keeps 1-4, 6, 7 (5 and 8 are Featured-only, gated on
// search_rank ≥ 3); Featured keeps all eight (PR55).
const TUTOR_FEATURES: Feature[] = [
  // Premium shows "100 Jobs" (owner PR57 §A); Featured keeps "Unlimited
  // applications"; Basic's line is in tutorFreeRows.
  { label: (p) => (p.code === 'premium' ? '100 Jobs' : isUnlimited(p) ? 'Unlimited applications' : `Apply — ${quota(p)} a month`), level: (p) => p.monthly_quota },
  { label: () => 'See parent phone & email — unlimited', level: (p) => (p.can_view_contact ? 1 : 0) },
  { label: () => 'WhatsApp parents with one tap', level: (p) => (p.can_whatsapp ? 1 : 0) },
  { label: () => 'See who viewed your profile', level: (p) => (p.can_see_viewer_identity ? 1 : 0) },
  { label: () => 'Top of search results', level: (p) => (p.search_rank >= 3 ? 3 : 0) },
  { label: (p) => (isUnlimited(p) ? 'Unlimited hiring & demo requests' : `Incoming hiring & demo requests — ${quota(p)} a month`), level: (p) => p.monthly_quota },
  { label: () => 'Matched tuitions on your email', level: (p) => (p.can_view_contact ? 1 : 0) },
  { label: () => 'Matched tuitions on your WhatsApp', level: (p) => (p.search_rank >= 3 ? 3 : 0) },
]

const PARENT_FEATURES: Feature[] = [
  { label: (p) => (isUnlimited(p) ? 'Unlimited tuition posts' : `Post ${quota(p)} tuitions a month`), level: (p) => p.monthly_quota },
  { label: () => 'Message any tutor', level: (p) => (p.can_initiate_message ? 1 : 0) },
  { label: () => 'See tutor phone & WhatsApp', level: (p) => (p.can_view_contact ? 1 : 0) },
  { label: () => 'WhatsApp tutors with one tap', level: (p) => (p.can_whatsapp ? 1 : 0) },
  { label: () => 'Complete a hire', level: (p) => (p.can_hire ? 1 : 0) },
  // §4.4: "Standard job placement" is removed — the ranking line appears ONLY
  // when the plan actually ranks jobs first (Featured), never on the free tier.
  { label: () => 'Your jobs shown first', level: (p) => (p.search_rank >= 3 ? 3 : 0) },
]

// The tutor free (Basic) card is a FIXED list (owner PR14 §4.1) — no "Start a
// conversation", no "Listed in search results". The two "a month" figures are
// the plan's own displayed quota (from the row), never a hard-coded number.
function tutorFreeRows(p: PlanRow): string[] {
  return [
    'Browse tuitions',
    `Apply — ${quota(p)} a month`,
    'Message parents in the app',
    'See parent phone & email — 5',
    'Download your CV',
    `Incoming hiring & demo requests — ${quota(p)} a month`,
  ]
}

// The parent free tier's universal truths — constant, not in any plans column.
const PARENT_BASE = ['Browse tutors', 'Request a demo']

export default function PackagesTable({
  plans,
  audience,
  currentPlan,
  expiresAt,
  highlight,
  instantActivation,
  signedIn,
  verified,
}: {
  plans: PlanRow[]
  audience: 'tutor' | 'parent'
  currentPlan: string | null
  expiresAt: string | null
  /** From ?plan= — the card an upgrade prompt sent them here to look at. */
  highlight: string | null
  /** True when a gateway is live; false while manual transfer is the path. */
  instantActivation: boolean
  signedIn: boolean
  /** Identity verified. Only gates the free tier's "Get verified" CTA. */
  verified: boolean
}) {
  const currentRank = plans.find((p) => p.code === currentPlan)?.search_rank ?? 0
  const features = audience === 'tutor' ? TUTOR_FEATURES : PARENT_FEATURES
  const free = plans.find((p) => p.price_pkr === 0) ?? null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
          const mine = p.code === currentPlan
          const spotlit = !mine && p.code === highlight
          const isFree = p.price_pkr === 0
          const lower = !mine && p.search_rank < currentRank

          // The free card shows its own features; a paid card shows only the
          // additions over the free tier (owner PR13 §1.4/§1.5). The tutor free
          // card is the exact fixed list (owner PR14 §4.1).
          const rows =
            isFree && audience === 'tutor'
              ? tutorFreeRows(p)
              : isFree || !free
                ? [
                    ...PARENT_BASE,
                    ...features.filter((f) => f.level(p) > 0).map((f) => f.label(p)),
                  ]
                : features.filter((f) => f.level(p) > f.level(free)).map((f) => f.label(p))

          return (
            <section
              key={p.code}
              className={`relative flex flex-col gap-3 rounded-2xl border bg-white p-5 ${
                mine
                  ? 'border-tm-green-deep ring-1 ring-tm-green-deep'
                  : spotlit
                    ? 'border-tm-red ring-2 ring-tm-red/30'
                    : 'border-gray-200'
              }`}
            >
              {p.tag_label && (
                <span className="absolute right-4 top-4">
                  <FeaturedTag />
                </span>
              )}

              <div className="space-y-1">
                <h2 className="text-base font-black text-tm-navy">{p.name}</h2>
                {/* §1.3: "Rs. 499*" / "Rs. 999*", no "/ month" on the card — the
                    30-day term and non-refundable note are in the footnote below
                    the cards. */}
                <p className="text-2xl font-black text-tm-navy">
                  {isFree ? 'Free' : <>Rs. {p.price_pkr.toLocaleString('en-PK')}*</>}
                </p>
                {/* The free tutor card is the plan a tutor is on AFTER the
                    one-time verification fee — stated in words, no amount (the
                    fee's price lives only on the payment page). */}
                {isFree && audience === 'tutor' && (
                  <p className="text-[11px] font-semibold text-gray-500">After the one-time verification fee</p>
                )}
              </div>

              <BadgeRow badges={(p.badges ?? []) as BadgeName[]} size="sm" showLabel />

              {!isFree && free && (
                <p className="text-[11px] font-black text-tm-navy">Everything in {free.name}, plus:</p>
              )}

              <ul className="flex-1 space-y-1.5 text-xs">
                {rows.map((label, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-slate-700">
                    <Check size={14} className="mt-px shrink-0 text-tm-green-deep" aria-hidden="true" />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>

              {mine ? (
                <div className="rounded-xl bg-tm-green-deep/10 p-3 text-center">
                  <p className="text-[11px] font-black text-tm-green-deep">
                    Current plan
                    {expiresAt ? ` · runs until ${formatDate(expiresAt)}` : ''}
                  </p>
                </div>
              ) : lower ? (
                // No downgrade offers: a member never sees a button for a tier
                // below the one they hold.
                null
              ) : isFree ? (
                // The free tier. Show how to reach it only when the member is not
                // verified yet; a verified member sees nothing here. A tutor
                // reaches it through the one-time verification fee, a parent
                // through free CNIC + address verification.
                !verified ? (
                  <Link
                    href={audience === 'tutor' ? '/tutor/complete-profile?step=verify' : '/parent/verify'}
                    className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                  >
                    <ShieldCheck aria-hidden size={14} />
                    {audience === 'tutor' ? 'Get verified' : 'Verify your CNIC (free)'}
                  </Link>
                ) : null
              ) : (
                <BuyButton
                  planCode={p.code}
                  planName={p.name}
                  signedIn={signedIn}
                  upgrading={!!currentPlan}
                  emphasis={spotlit}
                />
              )}
            </section>
          )
        })}
      </div>

      {/* §1.4: the asterisk footnote, directly under the cards, per tab. */}
      <p className="text-[11px] text-gray-500">
        {audience === 'tutor'
          ? '*Premium and Featured run for 30 days from the day you’re verified and your profile is complete. Non-refundable.'
          : '*Featured runs for 30 days from the day it activates. Non-refundable.'}
      </p>

      {/* The monthly-plan terms — once per tab (owner PR13 §1.6). Scoped to the
          paid MONTHLY plans so a tutor never reads "no refunds / 30 days" as
          applying to the one-time verification fee. */}
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed">
        <p className="text-xs font-black text-tm-navy">
          {audience === 'tutor'
            ? 'About the monthly plans (Premium and Featured)'
            : 'About the monthly plan (Featured)'}
        </p>
        <p>
          <strong className="text-tm-navy">Changing plan.</strong> Buying a different plan
          replaces the one you are on and runs a fresh 30 days from the moment it activates. There
          is no proration and no partial credit for the days left on your old plan.
        </p>
        <p>
          <strong className="text-tm-navy">Activation.</strong>{' '}
          {instantActivation
            ? 'Card and wallet payments activate as soon as the payment is confirmed.'
            : 'Bank and wallet transfers are confirmed by a person, usually within a few hours. You will get a notification the moment your plan starts.'}
        </p>
        {audience === 'tutor' && (
          <p>
            <strong className="text-tm-navy">Your month starts the day you’re verified.</strong> If you
            choose Premium or Featured earlier, the 30 days start the day you’re verified and your
            profile is complete (mobile, city, area, subjects, gender).
          </p>
        )}
        <p>
          <strong className="text-tm-navy">No refunds.</strong> Plans are non-refundable once
          activated, including if you change plan part-way through a month. This is set out in the{' '}
          <Link href="/terms" className="font-bold text-tm-red hover:underline">
            Terms
          </Link>
          .
        </p>
        <p>
          <strong className="text-tm-navy">When a plan ends.</strong> There is no grace period,
          and nothing is deleted. Your chats, applications, shortlists and posts all stay in your
          dashboard — only the plan powers switch off.
        </p>
      </section>
    </div>
  )
}
