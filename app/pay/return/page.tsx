import Link from 'next/link'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import BadgeRow from '@/components/badges/BadgeRow'

// Where the gateway sends the member back to.
//
// The status shown is read from OUR payment row, never from the query string.
// A gateway return URL is just a browser redirect: anyone can type it, and a
// page that believed ?status=success would hand out a "you're upgraded"
// screen to whoever asked. The webhook is what changes anything; this page
// only reports what it found.

export const dynamic = 'force-dynamic'

export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const { ref } = await searchParams
  const session = await getSessionUser()
  const userId = session!.user.id

  const supabase = await createClient()
  const { data: payment } = ref
    ? await supabase
        .from('payments')
        .select('id, plan_code, amount_pkr, status, provider, provider_ref, rejection_reason')
        .eq('provider_ref', ref)
        .eq('user_id', userId)
        .maybeSingle()
    : { data: null }

  const ent = await getEntitlements(userId)
  const home = ent.audience === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'
  const packages = ent.audience === 'tutor' ? '/tutor/packages' : '/parent/packages'

  const status = (payment?.status as string) ?? 'unknown'

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-10 text-[#334155] sm:px-6">
      <div className="mx-auto max-w-md space-y-4">
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 text-center">
          {status === 'approved' ? (
            <>
              <CheckCircle2 size={40} className="mx-auto text-[#059669]" />
              <h1 className="text-lg font-black text-[#0F172A]">Your plan is active</h1>
              <p className="text-xs leading-relaxed text-gray-500">
                {ent.planName} · {ent.displayedQuota} this month
                {ent.expiresAt
                  ? ` · renews ${new Date(ent.expiresAt).toLocaleDateString('en-PK')}`
                  : ''}
              </p>
              {ent.badges.length > 0 && (
                <div className="flex justify-center">
                  <BadgeRow badges={ent.badges} size="sm" showLabel />
                </div>
              )}
            </>
          ) : status === 'pending' ? (
            <>
              <Clock size={40} className="mx-auto text-[#F59E0B]" />
              <h1 className="text-lg font-black text-[#0F172A]">We are confirming your payment</h1>
              <p className="text-xs leading-relaxed text-gray-500">
                Nothing more to do. Your plan starts as soon as the payment is confirmed — usually
                within a few hours for a bank or wallet transfer.
              </p>
            </>
          ) : status === 'rejected' ? (
            <>
              <XCircle size={40} className="mx-auto text-[#d60008]" />
              <h1 className="text-lg font-black text-[#0F172A]">That payment did not go through</h1>
              <p className="text-xs leading-relaxed text-gray-500">
                {(payment?.rejection_reason as string) ??
                  'Nothing was charged and your plan is unchanged.'}
              </p>
            </>
          ) : (
            <>
              <Clock size={40} className="mx-auto text-gray-300" />
              <h1 className="text-lg font-black text-[#0F172A]">Nothing to show here</h1>
              <p className="text-xs leading-relaxed text-gray-500">
                We could not find that payment on your account.
              </p>
            </>
          )}

          {payment && (
            <p className="font-mono text-[10px] text-gray-400">{payment.provider_ref as string}</p>
          )}
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={home}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white"
          >
            Go to my dashboard
          </Link>
          <Link
            href={packages}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-[#334155]"
          >
            Packages
          </Link>
        </div>
      </div>
    </main>
  )
}
