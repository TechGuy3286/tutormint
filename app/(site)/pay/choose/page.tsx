import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import Breadcrumbs from '@/components/Breadcrumbs'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getGatewaySettings, onlineCheckoutOn } from '@/lib/payments/gatewaySettings'
import { pproVisibleFor } from '@/lib/payments/paypro'
import { loadBankPanel, loadReceiptState } from '@/lib/payments/receipt'
import { priceLine, rupees, supportWaLink } from '@/lib/payments/receiptCore'
import { payLogoSrc } from '@/lib/payments/logos'
import { FEE_LABEL } from '@/lib/display'
import { formatName } from '@/lib/formatName'
import { formatPkMobile } from '@/lib/phone'
import OrderPageNav from '../manual/[ref]/OrderPageNav'
import PayChoice from './PayChoice'
import { afterFeeReturnPath, safeReturnTo } from '@/lib/returnTo'
import { defaultPayChoose, payChooseHref } from '@/lib/payChooseDefault'

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

export default async function PayChoosePage({ searchParams }: { searchParams: Promise<{ plan?: string; next?: string }> }) {
  const { plan: planParam, next } = await searchParams
  const planCode = (planParam ?? '').trim()
  // The page to go back to after paying (the tuition the tutor tapped Apply on,
  // owner 15 Oct 2026). Same-site paths only.
  const returnTo = safeReturnTo(next)
  const here = payChooseHref(planCode, returnTo)

  const session = await getSessionUser()
  if (!session) redirect(`/login?next=${encodeURIComponent(here)}`)
  const userId = session.user.id

  // No plan named (owner, 17 Oct 2026): a tutor who has not paid the
  // Verification Fee gets the fee checkout straight away; everyone else goes
  // to Membership Plans as before (lib/payChooseDefault).
  if (!planCode) {
    const supa = await createClient()
    const [{ data: me }, { data: tpRow }] = await Promise.all([
      supa.from('profiles').select('role').eq('id', userId).maybeSingle(),
      supa.from('tutor_profiles').select('verified_fee_paid_at').eq('id', userId).maybeSingle(),
    ])
    redirect(
      defaultPayChoose({
        role: (me?.role as string | null) ?? null,
        feePaid: !!tpRow?.verified_fee_paid_at,
        returnTo,
      }),
    )
  }

  const supabase = await createClient()
  const [{ data: plan }, { data: profile }] = await Promise.all([
    supabase.from('plans').select('code, name, audience, price_pkr').eq('code', planCode).maybeSingle(),
    supabase
      .from('profiles')
      .select('role, admin_role, is_seed, email, full_name, phone_number')
      .eq('id', userId)
      .maybeSingle(),
  ])

  const audience = profile?.role === 'tutor' ? 'tutor' : 'parent'
  const plansHref = `/membership-plans?for=${audience === 'tutor' ? 'tutors' : 'parents'}`
  const dashboard = audience === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'
  if (!plan || !profile || !(plan.price_pkr as number) || plan.audience !== audience) redirect(plansHref)

  const isFee = plan.code === 'verified'
  if (audience === 'tutor') {
    const { data: tp } = await supabase.from('tutor_profiles').select('verified_fee_paid_at').eq('id', userId).maybeSingle()
    const feePaid = !!tp?.verified_fee_paid_at
    // The fee is paid once; a plan needs the fee first (the checkout's own rules).
    if (isFee && feePaid) redirect((returnTo && afterFeeReturnPath(returnTo, 'paid')) || dashboard)
    if (!isFee && !feePaid) redirect(`/tutor/complete-profile?step=verify&next=${encodeURIComponent(here)}`)
  }

  const [settings, bank, receipt] = await Promise.all([
    getGatewaySettings(),
    loadBankPanel(),
    loadReceiptState(userId, plan.code as string),
  ])
  const online = onlineCheckoutOn(settings) && pproVisibleFor(profile)

  const packageName = isFee ? FEE_LABEL : `${plan.name} plan`
  const price = { code: plan.code as string, price_pkr: plan.price_pkr as number }
  const unlocks = UNLOCKS[plan.code as string] ?? null
  const mobile = profile.phone_number ? formatPkMobile(profile.phone_number as string) : null

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-lg space-y-4">
        <Breadcrumbs items={[{ label: isFee ? 'Tutor dashboard' : 'Membership Plans', href: isFee ? dashboard : plansHref }, { label: 'Payment' }]} />
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">
          {isFee ? 'Complete your verification' : 'Complete your payment'}
          <span lang="ur" dir="rtl" className="mt-0.5 block text-xs font-semibold text-gray-500">
            {isFee ? 'اپنی تصدیق مکمل کریں' : 'اپنی ادائیگی مکمل کریں'}
          </span>
        </h1>

        {/* The package card — the ONE place the amount is shown. */}
        <section className="space-y-1.5 rounded-2xl border border-tm-navy/15 bg-tm-tint-navy p-4" data-package-card="">
          <p className="text-sm font-black text-tm-navy">
            {packageName} — {priceLine(price)}
          </p>
          {unlocks && (
            <p className="text-xs leading-relaxed text-tm-navy">
              {unlocks.en}
              <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px] font-semibold">{unlocks.ur}</span>
            </p>
          )}
          <p className="text-[11px] font-semibold text-tm-navy">
            {isFee ? 'One-time. Non-refundable.' : 'Runs for 30 days. Non-refundable.'}
          </p>
        </section>

        <PayChoice
          planCode={plan.code as string}
          isFee={isFee}
          returnTo={isFee ? returnTo : null}
          amount={rupees(price.price_pkr)}
          online={online}
          bank={bank}
          receipt={receipt}
          waHref={supportWaLink({
            packageName,
            name: formatName(profile.full_name as string | null),
            mobile,
          })}
          logos={{ jazzcash: payLogoSrc('jazzcash') }}
        />

        {/* No "Pay later" on the payment screen (owner, 17 Oct 2026): Back alone,
            full width. The dashboard's "Complete your payment" reminder stays. */}
        <OrderPageNav dashboard={dashboard} payLater={false} />
      </div>
    </main>
  )
}
