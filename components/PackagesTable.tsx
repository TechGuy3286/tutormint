import Link from 'next/link'
import BadgeRow from '@/components/badges/BadgeRow'
import type { BadgeName } from '@/lib/planBadges'

// The plan matrix, rendered from the `plans` table.
//
// Shared by /tutor/packages and /parent/packages. Prices, quotas and powers
// are read from the database rather than written here, so what a member is
// shown and what lib/entitlements.ts actually grants come from the same row
// and cannot drift.
//
// T4 ships the comparison only -- checkout is T6. The page says so plainly
// instead of offering a Buy button that does nothing, and never promises
// instant activation, which is only true once AssanPay is live.

export type PlanRow = {
  code: string
  name: string
  price_pkr: number
  displayed_quota: string | null
  can_view_contact: boolean
  can_whatsapp: boolean
  can_initiate_message: boolean
  can_hire: boolean
  badges: string[] | null
}

export default function PackagesTable({
  plans,
  audience,
  currentPlan,
  quotaNoun,
}: {
  plans: PlanRow[]
  audience: 'tutor' | 'parent'
  currentPlan: string | null
  quotaNoun: string
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
          const mine = p.code === currentPlan
          return (
            <section
              key={p.code}
              className={`space-y-3 rounded-2xl border bg-white p-5 ${
                mine ? 'border-[#059669] ring-1 ring-[#059669]' : 'border-gray-200'
              }`}
            >
              <div className="space-y-1">
                <h2 className="text-base font-black text-[#0F172A]">{p.name}</h2>
                <p className="text-2xl font-black text-[#0F172A]">
                  {p.price_pkr === 0 ? (
                    'Free'
                  ) : (
                    <>
                      Rs. {p.price_pkr.toLocaleString('en-PK')}
                      <span className="text-xs font-semibold text-gray-400"> / month</span>
                    </>
                  )}
                </p>
              </div>

              <BadgeRow badges={(p.badges ?? []) as BadgeName[]} size="sm" showLabel />

              <ul className="space-y-1.5 text-xs">
                <li className="font-semibold text-[#0F172A]">
                  {p.displayed_quota ?? '0'} {quotaNoun} per month
                </li>
                <Feature on={p.can_view_contact}>See contact number and WhatsApp</Feature>
                <Feature on={p.can_whatsapp}>Send WhatsApp messages</Feature>
                <Feature on={p.can_initiate_message}>Start a conversation</Feature>
                {audience === 'parent' && <Feature on={p.can_hire}>Complete a hire</Feature>}
              </ul>

              {mine ? (
                <p className="rounded-xl bg-[#059669]/10 p-2 text-center text-[11px] font-black text-[#059669]">
                  Your current plan
                </p>
              ) : null}
            </section>
          )
        })}
      </div>

      <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-[#334155]">
        <strong className="text-[#0F172A]">Payments are not open yet.</strong> Checkout arrives in
        the next release. Nothing on this page charges you, and no plan is sold with a refund —
        please read the{' '}
        <Link href="/terms" className="font-bold text-[#d60008] hover:underline">
          Terms
        </Link>{' '}
        before buying when it opens.
      </p>
    </div>
  )
}

function Feature({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={on ? 'text-[#334155]' : 'text-gray-300 line-through'}>
      {on ? '✓' : '✕'} {children}
    </li>
  )
}
