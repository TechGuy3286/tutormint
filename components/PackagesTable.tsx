import Link from 'next/link'
import { Check, X } from 'lucide-react'
import BadgeRow from '@/components/badges/BadgeRow'
import FeaturedTag from '@/components/badges/FeaturedTag'
import type { BadgeName } from '@/lib/planBadges'
import BuyButton from '@/components/packages/BuyButton'
import { formatDate } from '@/lib/datetime'

// The plan matrix, rendered from the `plans` table.
//
// Prices, quotas and powers are read from the database rather than written
// here, so what a member is shown and what lib/entitlements.ts actually grants
// come from the same row and cannot drift. If the owner changes a plan in SQL,
// this page changes with it.
//
// Two things this component is careful about:
//
//   * The quota line shows the plan's own words -- "Unlimited" for the 100
//     cap -- because that is what was sold. The real cap is not hidden from
//     the member who hits it: lib/quota.ts tells them the actual number.
//
//   * Activation timing is never overstated. A gateway purchase is instant; a
//     bank transfer is "usually within a few hours" and says so. CLAUDE.md is
//     explicit that manual transfers must never be described as live.

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

export default function PackagesTable({
  plans,
  audience,
  currentPlan,
  expiresAt,
  highlight,
  quotaNoun,
  instantActivation,
  signedIn,
}: {
  plans: PlanRow[]
  audience: 'tutor' | 'parent'
  currentPlan: string | null
  expiresAt: string | null
  /** From ?plan= — the card an upgrade prompt sent them here to look at. */
  highlight: string | null
  quotaNoun: string
  /** True when a gateway is live; false while manual transfer is the path. */
  instantActivation: boolean
  signedIn: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
          const mine = p.code === currentPlan
          const spotlit = !mine && p.code === highlight
          const free = p.price_pkr === 0

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
                  {free ? (
                    'Free'
                  ) : (
                    <>
                      Rs. {p.price_pkr.toLocaleString('en-PK')}
                      <span className="text-xs font-semibold text-gray-500"> / month</span>
                    </>
                  )}
                </p>
              </div>

              <BadgeRow badges={(p.badges ?? []) as BadgeName[]} size="sm" showLabel />

              <ul className="flex-1 space-y-1.5 text-xs">
                <li className="font-semibold text-tm-navy">
                  {p.displayed_quota ?? '0'} {quotaNoun} per month
                </li>
                <li className="font-semibold text-tm-navy">{rankWords(audience, p.search_rank)}</li>
                <Feature on={p.can_view_contact}>
                  See {audience === 'tutor' ? 'parent' : 'tutor'} phone and WhatsApp
                </Feature>
                <Feature on={p.can_whatsapp}>WhatsApp with one tap</Feature>
                <Feature on={p.can_initiate_message}>
                  Start a conversation (everyone can always reply)
                </Feature>
                {audience === 'tutor' && (
                  <Feature on={p.can_see_viewer_identity}>See who viewed your profile</Feature>
                )}
                {audience === 'parent' && <Feature on={p.can_hire}>Complete a hire</Feature>}
              </ul>

              {mine ? (
                <div className="space-y-1 rounded-xl bg-tm-green-deep/10 p-3 text-center">
                  <p className="text-[11px] font-black text-tm-green-deep">Your current plan</p>
                  {expiresAt && (
                    <p className="text-[10px] font-semibold text-tm-green-deep">
                      Runs until {formatDate(expiresAt)}
                    </p>
                  )}
                </div>
              ) : free ? (
                <Link
                  href="/parent/verify"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                >
                  Verify to unlock
                </Link>
              ) : (
                <BuyButton
                  planCode={p.code}
                  planName={p.name}
                  pricePkr={p.price_pkr}
                  signedIn={signedIn}
                  upgrading={!!currentPlan}
                  emphasis={spotlit}
                />
              )}
            </section>
          )
        })}
      </div>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed">
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
  if (rank === 2) return 'Ranked above Verified tutors'
  return 'Listed in search results'
}

function Feature({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-1.5 ${on ? 'text-slate-700' : 'text-gray-300'}`}>
      {on ? (
        <Check size={14} className="mt-px shrink-0 text-tm-green-deep" aria-hidden="true" />
      ) : (
        <X size={14} className="mt-px shrink-0" aria-hidden="true" />
      )}
      <span className={on ? '' : 'line-through'}>{children}</span>
    </li>
  )
}
