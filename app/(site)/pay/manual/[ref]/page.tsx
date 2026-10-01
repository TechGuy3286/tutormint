import Breadcrumbs from '@/components/Breadcrumbs'
import { notFound } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { manualInstructions, availableMethods } from '@/lib/payments/manual'
import { checkoutVisibleFor } from '@/lib/payments/paypro'
import CopyButton from '@/components/admin/CopyButton'
import ManualPaymentForm from './ManualPaymentForm'
import OrderPageNav from './OrderPageNav'

// The bank / wallet transfer order page.
//
// Account details come from app_settings (env fallback), never from this file
// (CLAUDE.md rule 7); availableMethods() hides a channel with no details.
//
// A transfer WAITS FOR APPROVAL (PR98 §4): submitting records it, and an
// owner/admin confirms it on /admin/payments before the plan starts. The copy
// says so and never implies the plan is instant.
//
// Shown only to accounts inside the checkout gate (PR98 §2), the same set that
// could start the order. Back / Pay later let the member leave without losing
// the pending order (PR98 §3). English with Urdu underneath.

export const dynamic = 'force-dynamic'

const URDU_FONT =
  "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Nafees Nastaleeq', 'Urdu Typesetting', 'Segoe UI', system-ui, sans-serif"

function Ur({ children }: { children: React.ReactNode }) {
  return (
    <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px] text-gray-500" style={{ fontFamily: URDU_FONT }}>
      {children}
    </span>
  )
}

export default async function ManualPayPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const session = await getSessionUser()
  const userId = session!.user.id

  const supabase = await createClient()

  // Gate: only an account that could start checkout may see the order page.
  const { data: gateProfile } = await supabase
    .from('profiles')
    .select('admin_role, is_seed, email')
    .eq('id', userId)
    .maybeSingle()
  if (!gateProfile || !checkoutVisibleFor(gateProfile)) notFound()

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
  const dashboard = plan?.audience === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'
  const packagesHref = plan?.audience === 'tutor' ? '/membership-plans?for=tutors' : '/membership-plans?for=parents'
  // The one-time verification fee (plan_code 'verified') is not a 30-day plan.
  const isFee = (payment.plan_code as string) === 'verified'
  const amount = `Rs. ${(payment.amount_pkr as number).toLocaleString('en-PK')}`
  const hasBank = !!(instructions.iban || instructions.accountNumber)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-lg space-y-4">
        <Breadcrumbs items={[{ label: 'Membership Plans', href: packagesHref }, { label: 'Bank transfer' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">
            Pay by bank transfer
            <Ur>بینک ٹرانسفر سے ادائیگی</Ur>
          </h1>
          {isFee ? (
            <>
              <p className="text-xs text-gray-500">Profile verification · {amount} · one-time</p>
              <p className="text-xs font-bold text-tm-navy">This is a one-time fee. It is non-refundable.</p>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              {plan?.name ?? payment.plan_code} plan · {amount} for 30 days
            </p>
          )}
        </header>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-black text-tm-navy">
            1. Send {amount} to this account
            <Ur>اس اکاؤنٹ میں {amount} بھیجیں</Ur>
          </h2>

          {!hasBank && methods.length === 0 ? (
            <p className="rounded-xl bg-tm-tint-gold p-3 text-xs leading-relaxed text-tm-gold-ink">
              Transfer details are not published yet. Please contact support and we will send them to
              you directly.
            </p>
          ) : (
            <dl className="space-y-2 text-xs">
              {instructions.accountTitle && <Detail label="Account title" value={instructions.accountTitle} />}
              {instructions.bankName && <Detail label="Bank" value={instructions.bankName} />}
              {instructions.bankBranch && <Detail label="Branch" value={instructions.bankBranch} />}
              {instructions.accountNumber && (
                <Detail label="Account number" value={instructions.accountNumber} mono copy />
              )}
              {instructions.iban && <Detail label="IBAN" value={instructions.iban} mono copy />}
              {instructions.jazzcash && <Detail label="JazzCash" value={instructions.jazzcash} mono copy />}
              {instructions.easypaisa && <Detail label="Easypaisa" value={instructions.easypaisa} mono copy />}
            </dl>
          )}

          {instructions.qrPath && (
            <div className="flex flex-col items-center gap-1 rounded-xl bg-tm-bg p-3">
              {/* Served only through the gated route; hidden when no QR is set. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/payments/bank-qr" alt="Bank transfer QR code" className="h-40 w-40 object-contain" />
              <p className="text-[11px] text-gray-500">
                Scan to pay
                <Ur>ادائیگی کے لیے اسکین کریں</Ur>
              </p>
            </div>
          )}

          <div className="rounded-xl bg-tm-bg p-3 text-[11px] leading-relaxed">
            <span className="flex items-center justify-between gap-2">
              <span>
                Quote this reference in your transfer so we can match it:
                <Ur>ٹرانسفر میں یہ ریفرنس ضرور لکھیں تاکہ ہم اسے ملا سکیں</Ur>
              </span>
              <CopyButton text={payment.provider_ref as string} label="reference" />
            </span>
            <span className="mt-1 block font-mono text-xs font-bold text-tm-navy">
              {payment.provider_ref as string}
            </span>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-black text-tm-navy">
            2. Send us the receipt
            <Ur>رسید ہمیں بھیجیں</Ur>
          </h2>

          {payment.status === 'approved' ? (
            <p className="text-xs font-bold text-tm-green-deep">
              This payment is approved and your plan is active.
            </p>
          ) : payment.status === 'rejected' ? (
            <p className="text-xs font-bold text-tm-navy">
              This payment was not approved. You can start again from Membership Plans.
            </p>
          ) : (payment.reference as string | null) ? (
            // Already submitted — waiting for a person to approve it.
            <p className="text-xs font-bold text-tm-gold-ink">
              Your transfer is with our team for approval. You will be notified the moment it is
              approved.
              <Ur>آپ کی ادائیگی منظوری کے لیے ہماری ٹیم کے پاس ہے۔ منظوری ملتے ہی آپ کو اطلاع دی جائے گی۔</Ur>
            </p>
          ) : !hasBank && methods.length === 0 ? (
            <p className="text-xs text-gray-500">Nothing to submit yet.</p>
          ) : (
            <ManualPaymentForm reference={payment.provider_ref as string} methods={methods} />
          )}
        </section>

        <p className="flex items-start gap-2 rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4 text-[11px] leading-relaxed text-tm-gold-ink">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            Your plan starts once our team confirms your transfer, usually within a few hours. Plans
            are non-refundable.
            <Ur>آپ کا پلان ہماری ٹیم کی تصدیق کے بعد شروع ہوگا، عموماً چند گھنٹوں میں۔ ادائیگی ناقابلِ واپسی ہے۔</Ur>
          </span>
        </p>

        <OrderPageNav dashboard={dashboard} />
      </div>
    </main>
  )
}

function Detail({
  label,
  value,
  mono,
  copy,
}: {
  label: string
  value: string | null
  mono?: boolean
  copy?: boolean
}) {
  if (!value) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
      <dt className="font-bold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className={`text-right font-semibold text-tm-navy ${mono ? 'font-mono' : ''}`}>{value}</span>
        {copy && <CopyButton text={value} label={label.toLowerCase()} />}
      </dd>
    </div>
  )
}
