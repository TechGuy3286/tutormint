import { notFound } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { simulatorEnabled } from '@/lib/payments'
import SimulatorButtons from './SimulatorButtons'

// The test gateway's hosted page.
//
// Deliberately styled to look nothing like TutorMint: it is standing in for
// somebody else's website, and a fake checkout that looks like the real
// product is how a screenshot ends up in a deck captioned "we take payments".
// The banner says what it is in the largest type on the page.

export const dynamic = 'force-dynamic'

export default async function SimulatorPage({ params }: { params: Promise<{ ref: string }> }) {
  if (!simulatorEnabled()) notFound()

  const { ref } = await params
  const session = await getSessionUser()
  const userId = session!.user.id

  const supabase = await createClient()
  const { data: payment } = await supabase
    .from('payments')
    .select('id, plan_code, amount_pkr, status, provider, provider_ref')
    .eq('provider_ref', ref)
    .eq('user_id', userId)
    .maybeSingle()

  if (!payment || payment.provider !== 'simulator') notFound()

  const { data: plan } = await supabase
    .from('plans')
    .select('name, audience')
    .eq('code', payment.plan_code as string)
    .maybeSingle()

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-800">
      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-center">
          <p className="text-sm font-black uppercase tracking-wide text-amber-800">
            Test gateway — no money moves
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
            This page stands in for AssanPay while the integration is being signed. It signs a
            callback and posts it to the same webhook the real gateway will use.
          </p>
        </div>

        <section className="space-y-4 rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
          <h1 className="text-base font-bold">Confirm payment</h1>

          <dl className="space-y-2 text-sm">
            <Row label="Merchant" value="TutorMint" />
            <Row label="Item" value={`${plan?.name ?? payment.plan_code} plan — 30 days`} />
            <Row
              label="Amount"
              value={`PKR ${(payment.amount_pkr as number).toLocaleString('en-PK')}`}
            />
            <Row label="Order reference" value={payment.provider_ref as string} mono />
            <Row label="Status" value={payment.status as string} />
          </dl>

          {payment.status === 'pending' ? (
            <SimulatorButtons reference={payment.provider_ref as string} />
          ) : (
            <p className="rounded border border-slate-200 bg-slate-50 p-3 text-center text-xs font-bold">
              This order has already been {payment.status}.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-right text-sm font-semibold ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
