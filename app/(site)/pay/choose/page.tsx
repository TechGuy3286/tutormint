import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import Breadcrumbs from '@/components/Breadcrumbs'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadBankPanel, loadReceiptState } from '@/lib/payments/receipt'
import { priceLine, rupees, supportWaLink } from '@/lib/payments/receiptCore'
import { FEE_LABEL } from '@/lib/display'
import { formatName } from '@/lib/formatName'
import { formatPkMobile } from '@/lib/phone'
import OrderPageNav from '../manual/[ref]/OrderPageNav'
import PayChoice from './PayChoice'
import Link from 'next/link'
import { safeReturnTo } from '@/lib/returnTo'
import { payChooseHref } from '@/lib/payChooseDefault'
import { PAY_LOOP_NOTE, payChooseRoute } from '@/lib/payChooseRouteCore'

// The payment choice screen (owner, 11 Oct 2026).
//
// Every paid checkout stops here BEFORE any redirect: the Verification Fee and
// the Premium / Featured plans. It shows the package and — on this screen ONLY —
// its amount, read from the same `plans` row the payment is charged from, then
// two ways to pay:
//
//   • JazzCash (PayPro): exactly the checkout that ran before this screen
//     existed (same order creation, same callbacks, activates automatically);
//   • Other methods (bank transfer from any bank app, Easypaisa or ATM): the owner's bank details, a receipt upload,
//     and activation only after staff approve the receipt.
//
// "Other methods" is absent when the owner's switch is off or the bank details
// are not filled in (lib/payments/receipt loadBankPanel). While a receipt is
// under review the screen shows that status and nothing to pay with, so nobody
// pays twice.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Complete your payment | TutorMint',
  robots: { index: false, follow: false },
}

// One line on what the package unlocks — the wording the verify gate and the
// plans page already use. Visibility and access only; never an outcome.
const UNLOCKS: Record<string, { en: string; ur: string }> = {
  verified: {
    en: 'After verification, you can apply to tuitions and jobs and contact parents and employers directly.',
    ur: 'تصدیق کے بعد آپ ٹیوشنز اور جابز کے لیے اپلائی کر سکتے ہیں اور والدین سے براہِ راست رابطہ کر سکتے ہیں۔',
  },
  premium: {
    en: 'More applications each month, WhatsApp to parents, and a higher place in search.',
    ur: 'ہر ماہ زیادہ درخواستیں، والدین سے واٹس ایپ پر رابطہ، اور تلاش میں بہتر جگہ۔',
  },
  featured: {
    en: 'The top place in search, with everything in Premium.',
    ur: 'تلاش میں سب سے اوپر جگہ، اور پریمیم کی تمام سہولتیں۔',
  },
  parent_featured: {
    en: 'See tutors’ contact details, message them on WhatsApp and complete a hire.',
    ur: 'ٹیوٹرز کے رابطہ نمبر دیکھیں، واٹس ایپ پر پیغام کریں اور ٹیوٹر رکھیں۔',
  },
}

/** The fee's package card heading (owner, 27 Oct 2026 — exactly this text, in
 *  the brand green; it replaced the English one-time-fee line). The amount is on the
 *  Amount row. In this card the Urdu line comes first, the English under it. */
export const FEE_CARD_TITLE = 'تصدیق کروانا کیوں ضروری ہے؟'

export default async function PayChoosePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; next?: string; hop?: string }>
}) {
  const { plan: planParam, next, hop } = await searchParams
  const planCode = (planParam ?? '').trim()
  // The page to go back to after paying (the tuition the tutor tapped Apply on,
  // owner 15 Oct 2026). Same-site paths only.
  const returnTo = safeReturnTo(next)
  const here = payChooseHref(planCode, returnTo)

  const session = await getSessionUser()
  if (!session) redirect(`/login?next=${encodeURIComponent(here)}`)
  const userId = session.user.id

  const supabase = await createClient()
  const [{ data: planRow }, { data: profile }, { data: tp }] = await Promise.all([
    planCode
      ? supabase.from('plans').select('code, name, audience, price_pkr').eq('code', planCode).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('profiles')
      .select('role, admin_role, is_seed, email, full_name, phone_number')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('tutor_profiles').select('verified_fee_paid_at').eq('id', userId).maybeSingle(),
  ])
  if (!profile) redirect('/membership-plans')

  const audience = profile.role === 'tutor' ? 'tutor' : 'parent'
  const plansHref = `/membership-plans?for=${audience === 'tutor' ? 'tutors' : 'parents'}`
  const dashboard = audience === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'
  const feePaid = !!tp?.verified_fee_paid_at

  // Every automatic redirect this page makes, and the bounce guard, in one pure
  // function (lib/payChooseRouteCore; hotfix 26 Oct 2026). No plan named → the
  // fee for an unpaid tutor, else Membership Plans; a plan not for this member →
  // Membership Plans; the fee already paid → back; a plan before the fee → the
  // verify step.
  const route = payChooseRoute({
    planCode,
    returnTo,
    hop: hop === '1',
    role: (profile.role as string | null) ?? null,
    plan: planRow
      ? { code: planRow.code as string, audience: planRow.audience as string, pricePkr: (planRow.price_pkr as number) ?? 0 }
      : null,
    feePaid,
  })
  if (route.kind === 'redirect') redirect(route.to)

  let plan = planRow
  let stopped = false
  if (route.kind === 'stopped') {
    // We redirected this request here ourselves and were about to redirect it
    // again: stop, say so, and log it (ids only — never a contact detail).
    stopped = true
    console.warn(`[pay-redirect-guard] stopped user=${userId} plan=${planCode || '-'} reason=${route.reason}`)
    if (!route.payPlan) {
      return (
        <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8">
          <div className="mx-auto max-w-lg space-y-4">
            <p role="alert" className="rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-4 text-sm font-bold text-tm-gold-ink">
              {PAY_LOOP_NOTE}
            </p>
            <Link href={dashboard} className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-bold text-white hover:bg-tm-navy-hover">
              Go to your dashboard
            </Link>
            <Link href={plansHref} className="block text-center text-xs font-bold text-tm-navy underline-offset-2 hover:underline">
              Membership Plans
            </Link>
          </div>
        </main>
      )
    }
    const { data: feeRow } = await supabase.from('plans').select('code, name, audience, price_pkr').eq('code', route.payPlan).maybeSingle()
    if (!feeRow) redirect(dashboard)
    plan = feeRow
  }
  if (!plan) redirect(plansHref)
  const isFee = plan.code === 'verified'

  const [bank, receipt] = await Promise.all([
    loadBankPanel(),
    loadReceiptState(userId, plan.code as string),
  ])

  const packageName = isFee ? FEE_LABEL : `${plan.name} plan`
  const price = { code: plan.code as string, price_pkr: plan.price_pkr as number }
  const unlocks = UNLOCKS[plan.code as string] ?? null
  const mobile = profile.phone_number ? formatPkMobile(profile.phone_number as string) : null

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-lg space-y-4">
        {/* The breadcrumb stays; its "Back to …" link above the title is gone (owner, 26 Oct 2026). */}
        <Breadcrumbs showBack={false} items={[{ label: isFee ? 'Tutor dashboard' : 'Membership Plans', href: isFee ? dashboard : plansHref }, { label: 'Payment' }]} />
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">
          {isFee ? 'Complete your verification' : 'Complete your payment'}
          {!isFee && (
            <span lang="ur" dir="rtl" className="mt-0.5 block text-xs font-semibold text-gray-500">
              اپنی ادائیگی مکمل کریں
            </span>
          )}
        </h1>

        {stopped && (
          <p role="alert" className="rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-3 text-xs font-bold text-tm-gold-ink">
            {PAY_LOOP_NOTE}
          </p>
        )}

        {/* The package card — the ONE place the amount is shown. */}
        <section className="space-y-1.5 rounded-2xl border border-tm-navy/15 bg-tm-tint-navy p-4" data-package-card="">
          {isFee ? (
            <p lang="ur" dir="rtl" className="text-xl font-black leading-snug text-tm-green-deep" data-fee-card-title="">
              {FEE_CARD_TITLE}
            </p>
          ) : (
            <p className="text-sm font-black text-tm-navy">
              {packageName} — {priceLine(price)}
            </p>
          )}
          {unlocks && isFee && (
            <p className="text-xs leading-relaxed text-tm-navy">
              <span lang="ur" dir="rtl" className="block text-[11px] font-semibold">{unlocks.ur}</span>
              <span className="mt-0.5 block">{unlocks.en}</span>
            </p>
          )}
          {unlocks && !isFee && (
            <p className="text-xs leading-relaxed text-tm-navy">
              {unlocks.en}
              <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px] font-semibold">{unlocks.ur}</span>
            </p>
          )}
          {!isFee && <p className="text-[11px] font-semibold text-tm-navy">Runs for 30 days. Non-refundable.</p>}
        </section>

        <PayChoice
          planCode={plan.code as string}
          isFee={isFee}
          returnTo={isFee ? returnTo : null}
          amount={rupees(price.price_pkr)}
          bank={bank}
          receipt={receipt}
          waHref={supportWaLink({
            packageName,
            name: formatName(profile.full_name as string | null),
            mobile,
          })}
        />

        {/* No "Pay later" on the payment screen (owner, 17 Oct 2026): Back alone,
            full width. The dashboard's "Complete your payment" reminder stays. */}
        <OrderPageNav dashboard={dashboard} payLater={false} />
      </div>
    </main>
  )
}
