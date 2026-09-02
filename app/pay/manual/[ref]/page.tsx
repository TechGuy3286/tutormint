import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { manualInstructions, availableMethods } from '@/lib/payments/manual'
import ManualPaymentForm from './ManualPaymentForm'

// Transfer instructions and the receipt form.
//
// Account details come from app_settings (env fallback), never from this file
// -- CLAUDE.md rule 7. A channel with no details configured is not offered at
// all rather than shown blank, which is why availableMethods() exists.
//
// The copy here is the part the owner was specific about: a manual transfer is
// not instant, and this page must not imply it is. "Usually activated within a
// few hours", and no refunds, stated before the member sends money rather than
// after.

export const dynamic = 'force-dynamic'

export default async function ManualPayPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const session = await getSessionUser()
  const userId = session!.user.id

  const supabase = await createClient()
  const { data: payment } = await supabase
    .from('payments')
    .select('id, plan_code, amount_pkr, status, provider, provider_ref, method, reference')
    .eq('provider_ref', ref)
    .eq('user_id', userId)
    .maybeSingle()

  if (!payment) notFound()

  const { data: plan } = await supabase
    .from('plans')
    .select('name, audience')
    .eq('code', payment.plan_code as string)
    .maybeSingle()

  const instructions = await manualInstructions()
  const methods = availableMethods(instructions)
  const packagesHref = plan?.audience === 'tutor' ? '/tutor/packages' : '/parent/packages'

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Complete your transfer</h1>
          <p className="text-xs text-gray-500">
            {plan?.name ?? payment.plan_code} plan · Rs.{' '}
            {(payment.amount_pkr as number).toLocaleString('en-PK')} for 30 days
          </p>
        </header>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-black text-tm-navy">1. Send the amount</h2>

          {methods.length === 0 ? (
            <p className="rounded-xl bg-tm-tint-gold p-3 text-xs leading-relaxed text-tm-gold-ink">
              Transfer details are not published yet. Please contact support and we will send them
              to you directly.
            </p>
          ) : (
            <dl className="space-y-2 text-xs">
              {instructions.iban && (
                <>
                  <Detail label="Bank" value={instructions.bankName} />
                  <Detail label="Account title" value={instructions.accountTitle} />
                  <Detail label="IBAN" value={instructions.iban} mono />
                </>
              )}
              {instructions.jazzcash && (
                <Detail label="JazzCash" value={instructions.jazzcash} mono />
              )}
              {instructions.easypaisa && (
                <Detail label="Easypaisa" value={instructions.easypaisa} mono />
              )}
            </dl>
          )}

          <p className="rounded-xl bg-tm-bg p-3 text-[11px] leading-relaxed">
            Quote this reference in your transfer so we can match it:
            <span className="mt-1 block font-mono text-xs font-bold text-tm-navy">
              {payment.provider_ref as string}
            </span>
          </p>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-black text-tm-navy">2. Send us the receipt</h2>

          {payment.status !== 'pending' ? (
            <p className="text-xs font-bold text-tm-green-deep">
              This payment has already been {payment.status as string}.
            </p>
          ) : methods.length === 0 ? (
            <p className="text-xs text-gray-500">Nothing to submit yet.</p>
          ) : payment.reference ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-tm-navy">
                Received — we are checking your transfer.
              </p>
              <p className="text-[11px] leading-relaxed text-gray-500">
                Transactions are usually confirmed within a few hours. You will get a notification
                the moment your plan starts.
              </p>
            </div>
          ) : (
            <ManualPaymentForm reference={payment.provider_ref as string} methods={methods} />
          )}
        </section>

        <p className="flex items-start gap-2 rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4 text-[11px] leading-relaxed text-tm-gold-ink">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            Bank and wallet transfers are checked by a person, so this is not instant — plans are
            usually activated within a few hours. Plans are non-refundable; please read the{' '}
            <Link href="/terms" className="font-bold underline">
              Terms
            </Link>{' '}
            before sending money.
          </span>
        </p>

        <Link
          href={packagesHref}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-slate-700"
        >
          Back to packages
        </Link>
      </div>
    </main>
  )
}

function Detail({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 pb-2">
      <dt className="font-bold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`text-right font-semibold text-tm-navy ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
