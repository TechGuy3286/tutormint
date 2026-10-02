import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'
import { CheckCircle2, Clock, CreditCard, LayoutDashboard, XCircle } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import BadgeRow from '@/components/badges/BadgeRow'
import { formatDate } from '@/lib/datetime'
import { confirmPayproOrder } from '@/lib/payments/payproReconcile'
import { payReturnView } from '@/lib/payments/returnView'

// Where the gateway sends the member back to — and where they land when they
// come back after a PayPro payment (PR65 §4).
//
// The status is read from OUR payment row, never from the query string (a return
// URL is just a browser redirect anyone can type). For a pending PayPro order we
// additionally confirm with Get Order Status (ggos) and, if PayPro says PAID and
// the amount matches, activate defensively — so a missed callback still lands the
// member on "your plan is active". Every state has a way forward: no dead end.
//
// English with Urdu underneath, the platform's usual bilingual style.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // ggos (node:https) needs the Node runtime

const URDU_FONT =
  "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Nafees Nastaleeq', 'Urdu Typesetting', 'Segoe UI', system-ui, sans-serif"

function Urdu({ children }: { children: React.ReactNode }) {
  return (
    <p lang="ur" dir="rtl" className="text-right text-[11px] leading-relaxed text-gray-500" style={{ fontFamily: URDU_FONT }}>
      {children}
    </p>
  )
}

type View = 'approved' | 'waiting' | 'notpaid' | 'unknown'

export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const { ref } = await searchParams
  const session = await getSessionUser()

  // A gateway return is just a browser redirect — the session cookie is normally
  // still present, but if it is not (e.g. a different browser, or it expired on
  // the gateway), this page must NOT 500. Show a neutral, bilingual result with a
  // way forward; the plan still activates on its own via the callback/cron.
  if (!session) {
    return (
      <main className="min-h-screen bg-tm-bg px-4 py-10 text-slate-700 sm:px-6">
        <div className="mx-auto max-w-md space-y-4">
          <Breadcrumbs items={[{ label: 'Payment' }]} />
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 text-center">
            <Clock size={40} className="mx-auto text-tm-gold-ink" />
            <h1 className="text-lg font-black text-tm-navy">Your payment is being processed</h1>
            <p className="text-xs leading-relaxed text-gray-500">
              Sign in to see your plan. If you have just paid, your plan activates on its own — you don&rsquo;t need to do anything.
            </p>
            <Urdu>آپ کی ادائیگی پر کارروائی ہو رہی ہے۔ اپنا پلان دیکھنے کے لیے سائن اِن کریں۔ آپ کا پلان خود بخود چالو ہو جائے گا۔</Urdu>
          </section>
          <Link
            href={`/login${ref ? `?next=${encodeURIComponent(`/pay/return?ref=${ref}`)}` : ''}`}
            className="gap-1.5 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white"
          >
            <LayoutDashboard aria-hidden size={14} />
            Go to my dashboard
          </Link>
        </div>
      </main>
    )
  }
  const userId = session.user.id

  const supabase = await createClient()
  const { data: payment } = ref
    ? await supabase
        .from('payments')
        .select('id, plan_code, amount_pkr, status, provider, provider_ref, rejection_reason, raw')
        .eq('provider_ref', ref)
        .eq('user_id', userId)
        .maybeSingle()
    : { data: null }

  // Confirm a pending PayPro order with ggos, and activate if it is genuinely
  // paid (the callback/cron do this too — this is the defensive third path).
  let clickToPay: string | null = null
  let status = (payment?.status as string) ?? 'unknown'
  let view: View = payReturnView(status)

  if (payment && payment.provider === 'paypro' && status === 'pending') {
    const raw = payment.raw as { paypro?: { click2pay?: string } } | null
    clickToPay = raw?.paypro?.click2pay ?? null
    // The SAME confirm+activate path as the callback and the cron (PR104): ggos,
    // the amount rule that allows a gateway fee on top of our price, activate.
    const r = await confirmPayproOrder({
      id: payment.id as string,
      amount_pkr: payment.amount_pkr as number,
      status: payment.status as string,
      provider_ref: payment.provider_ref as string,
      raw: payment.raw,
    })
    if (r.activated || r.alreadyActive) {
      status = 'approved'
      view = 'approved'
    }
    // Otherwise leave as 'waiting' — the member may still be completing payment,
    // and the 5-minute cron keeps retrying. (ggos failure is also 'waiting'.)
  }

  const ent = await getEntitlements(userId)
  const home = ent.audience === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'
  const packages = ent.audience === 'tutor' ? '/membership-plans?for=tutors' : '/membership-plans?for=parents'

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-10 text-slate-700 sm:px-6">
      <div className="mx-auto max-w-md space-y-4">
        <Breadcrumbs items={[{ label: 'Payment' }]} />
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 text-center">
          {view === 'approved' ? (
            <>
              <CheckCircle2 size={40} className="mx-auto text-tm-green-deep" />
              <h1 className="text-lg font-black text-tm-navy">Your plan is active</h1>
              <p className="text-xs leading-relaxed text-gray-500">
                {ent.planName} · {ent.displayedQuota} this month
                {ent.expiresAt ? ` · renews ${formatDate(ent.expiresAt)}` : ''}
              </p>
              <Urdu>آپ کی ادائیگی موصول ہو گئی اور آپ کا پلان چالو ہو گیا ہے۔</Urdu>
              {ent.badges.length > 0 && (
                <div className="flex justify-center">
                  <BadgeRow badges={ent.badges} size="sm" showLabel />
                </div>
              )}
            </>
          ) : view === 'waiting' ? (
            payment?.provider === 'manual' ? (
              <>
                <Clock size={40} className="mx-auto text-tm-gold-ink" />
                <h1 className="text-lg font-black text-tm-navy">We&rsquo;re checking your transfer</h1>
                <p className="text-xs leading-relaxed text-gray-500">
                  Thank you. Our team will confirm your transfer and activate your plan, usually
                  within a few hours. You will get a notification the moment it is approved.
                </p>
                <Urdu>آپ کی ادائیگی موصول ہو گئی ہے۔ ہماری ٹیم تصدیق کے بعد آپ کا پلان چالو کر دے گی، عموماً چند گھنٹوں میں۔ منظوری ملتے ہی آپ کو اطلاع مل جائے گی۔</Urdu>
              </>
            ) : (
              <>
                <Clock size={40} className="mx-auto text-tm-gold-ink" />
                <h1 className="text-lg font-black text-tm-navy">We&rsquo;re still waiting for your payment</h1>
                <p className="text-xs leading-relaxed text-gray-500">
                  If you have just paid, it can take a minute to confirm. Your plan will start on its own —
                  you don&rsquo;t need to do anything.
                </p>
                <Urdu>اگر آپ نے ابھی ادائیگی کی ہے تو تصدیق میں ایک منٹ لگ سکتا ہے۔ آپ کا پلان خود بخود چالو ہو جائے گا۔</Urdu>
              </>
            )
          ) : view === 'notpaid' ? (
            <>
              <XCircle size={40} className="mx-auto text-tm-red" />
              <h1 className="text-lg font-black text-tm-navy">Payment didn&rsquo;t go through</h1>
              <p className="text-xs leading-relaxed text-gray-500">
                {(payment?.rejection_reason as string) ?? 'Nothing was charged and your plan is unchanged. You can try again or pay later.'}
              </p>
              <Urdu>ادائیگی مکمل نہیں ہوئی۔ آپ سے کچھ وصول نہیں کیا گیا — آپ دوبارہ کوشش کر سکتے ہیں یا بعد میں ادائیگی کر سکتے ہیں۔</Urdu>
            </>
          ) : (
            <>
              <Clock size={40} className="mx-auto text-gray-300" />
              <h1 className="text-lg font-black text-tm-navy">Nothing to show here</h1>
              <p className="text-xs leading-relaxed text-gray-500">We could not find that payment on your account.</p>
              <Urdu>ہمیں آپ کے اکاؤنٹ پر یہ ادائیگی نہیں ملی۔</Urdu>
            </>
          )}

          {payment && <p className="font-mono text-[10px] text-gray-500">{payment.provider_ref as string}</p>}
        </section>

        {/* Continue an unfinished PayPro payment, or try again — never a dead end. */}
        {view === 'waiting' && clickToPay && (
          <a
            href={clickToPay}
            className="gap-1.5 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover"
          >
            <CreditCard aria-hidden size={14} />
            Continue your payment
          </a>
        )}
        {view === 'notpaid' && (
          <Link
            href={packages}
            className="gap-1.5 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover"
          >
            <CreditCard aria-hidden size={14} />
            Try again
          </Link>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={home}
            className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white"
          >
            <LayoutDashboard aria-hidden size={14} />
            Go to my dashboard
          </Link>
          <Link
            href={packages}
            className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-slate-700"
          >
            <CreditCard aria-hidden size={14} />
            Membership Plans
          </Link>
        </div>
      </div>
    </main>
  )
}
