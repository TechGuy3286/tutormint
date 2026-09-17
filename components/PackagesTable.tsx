import Link from 'next/link'
import { Check, ShieldCheck } from 'lucide-react'
import BadgeRow from '@/components/badges/BadgeRow'
import FeaturedTag from '@/components/badges/FeaturedTag'
import type { BadgeName } from '@/lib/planBadges'
import BuyButton from '@/components/packages/BuyButton'
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

const TUTOR_FEATURES: Feature[] = [
  { label: (p) => `Apply to ${quota(p)} tuitions a month`, level: (p) => p.monthly_quota },
  { label: () => 'Start a conversation with any parent', level: (p) => (p.can_initiate_message ? 1 : 0) },
  { label: () => 'See parent phone & WhatsApp', level: (p) => (p.can_view_contact ? 1 : 0) },
  { label: () => 'WhatsApp parents with one tap', level: (p) => (p.can_whatsapp ? 1 : 0) },
  { label: () => 'See who viewed your profile', level: (p) => (p.can_see_viewer_identity ? 1 : 0) },
  { label: (p) => rankWords('tutor', p.search_rank), level: (p) => p.search_rank },
  { label: (p) => `Incoming hiring & demo requests — ${quota(p)} a month`, level: (p) => p.monthly_quota },
]

const PARENT_FEATURES: Feature[] = [
  { label: (p) => `Post ${quota(p)} tuitions a month`, level: (p) => p.monthly_quota },
  { label: () => 'Message any tutor', level: (p) => (p.can_initiate_message ? 1 : 0) },
  { label: () => 'See tutor phone & WhatsApp', level: (p) => (p.can_view_contact ? 1 : 0) },
  { label: () => 'WhatsApp tutors with one tap', level: (p) => (p.can_whatsapp ? 1 : 0) },
  { label: () => 'Complete a hire', level: (p) => (p.can_hire ? 1 : 0) },
  { label: (p) => rankWords('parent', p.search_rank), level: (p) => p.search_rank },
]

// The free tier's universal truths — real, constant, and not represented by any
// plans column, so they are described here rather than read. They appear on the
// free card only; a paid card inherits them through "Everything in <free>, plus".
const TUTOR_BASE = ['Reply to parents who message you', 'Download your CV, free']
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
  const baseTruths = audience === 'tutor' ? TUTOR_BASE : PARENT_BASE
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
          // additions over the free tier (owner PR13 §1.4/§1.5).
          const rows = isFree || !free
            ? [
                ...baseTruths,
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
                <p className="text-2xl font-black text-tm-navy">
                  {isFree ? (
                    'Free'
                  ) : (
                    <>
                      Rs. {p.price_pkr.toLocaleString('en-PK')}
                      <span className="text-xs font-semibold text-gray-500"> / month</span>
                    </>
                  )}
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
                    href={audience === 'tutor' ? '/tutor/verify' : '/parent/verify'}
                    className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                  >
                    <ShieldCheck aria-hidden size={14} />
                    {audience === 'tutor' ? 'Get verified' : 'Verify to unlock'}
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
          is no proration and no partial credit for the days left on your old plan — we keep it
          simple rather than clever.
        </p>
        <p>
          <strong className="text-tm-navy">Activation.</strong>{' '}
          {instantActivation
            ? 'Card and wallet payments activate as soon as the payment is confirmed.'
            : 'Bank and wallet transfers are confirmed by a person, usually within a few hours. You will get a notification the moment your plan starts.'}
        </p>
        {audience === 'tutor' && (
          <p>
            <strong className="text-tm-navy">Your month starts the day you go live.</strong> If you
            buy Premium or Featured before your identity and mobile number are verified, the plan is
            paid for but paused — the 30 days begin the day you become listed, so nothing counts down
            while you get there.
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

function rankWords(audience: 'tutor' | 'parent', rank: number): string {
  if (audience === 'parent') {
    return rank >= 3 ? 'Your jobs shown first' : 'Standard job placement'
  }
  if (rank >= 3) return 'Top of search results'
  if (rank === 2) return 'Ranked above Basic tutors'
  return 'Listed in search results'
}
