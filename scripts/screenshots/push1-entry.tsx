// scripts/screenshots/push1-entry.tsx — the 31 Oct 2026 push-1 screenshots,
// rendered in a browser from the REAL components with INVENTED data only (no
// member's name, phone or address). Bundled by scripts/screenshots/push1.mjs;
// window.fetch is answered from fixtures, nothing reaches a server.
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import { AdminReadOnlyProvider } from '@/components/admin/ReadOnly'
import NumberFirstGate from '@/components/forms/NumberFirstGate'
import MemberTabs from '@/components/admin/MemberTabs'
import TutorFieldEditor from '@/app/admin/users/[id]/edit/TutorFieldEditor'
import SwitchesForm from '@/app/admin/payments/settings/SwitchesForm'
import OnboardingModeForm from '@/app/admin/payments/settings/OnboardingModeForm'
import GatewaysClient from '@/app/admin/payments/settings/gateways/GatewaysClient'
import BankDetailsForm from '@/app/admin/payments/bank-details/BankDetailsForm'
import FinanceSettingsView from '@/app/admin/finance/settings/FinanceSettingsView'
import ReaderSwitch from '@/app/admin/finance/settings/ReaderSwitch'
import FeeRangeForm from '@/app/admin/finance/settings/FeeRangeForm'
import PayproSettlementCard from '@/components/admin/PayproSettlementCard'
import EmailHealthView from '@/app/admin/settings/email/EmailHealthView'
import EmailUsageView from '@/app/admin/settings/email-usage/EmailUsageView'
import SmsHealthView from '@/app/admin/settings/sms/SmsHealthView'
import { PAYMENT_SETTINGS_SECTIONS } from '@/lib/paymentSettingsCore'
import { numberFirstOutcome, type ExistingTuition } from '@/lib/numberFirstCore'
import { fillSocialLinks, socialLinksBlock, socialPagesFrom, SOCIAL_LINKS_DEFAULT } from '@/lib/socialLinksCore'

const which = ((window as unknown as { __SHOT?: string }).__SHOT) ?? 'nf-clear'
const NOW = Date.UTC(2026, 9, 31, 9, 0, 0)
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const H = 3_600_000
const D = 24 * H

// Invented parent number (not a real member's): shown masked only.
const MSISDN = '923009998877'
const TUITIONS: ExistingTuition[] = [
  { id: 'a1', ref: 'TM-9101', title: 'Female Home Tutor Required | Grade 1–5 | Johar Town', city: 'Lahore', status: 'open', postedAt: ago(2 * D), poster: 'Hira Baig', href: '#' },
  { id: 'a2', ref: 'TM-9055', title: 'Home Tutor Required | Matric | Johar Town', city: 'Lahore', status: 'paused', postedAt: ago(24 * D), poster: 'TutorMint team', href: '#' },
]
const OUTCOMES = {
  'nf-dnu': numberFirstOutcome({ msisdn: MSISDN, doNotUse: true, onHold: false, tuitions: [], parent: null }),
  'nf-hold': numberFirstOutcome({ msisdn: MSISDN, doNotUse: false, onHold: true, tuitions: [], parent: null }),
  'nf-existing': numberFirstOutcome({ msisdn: MSISDN, doNotUse: false, onHold: false, tuitions: TUITIONS, parent: null }),
  'nf-parent': numberFirstOutcome({ msisdn: MSISDN, doNotUse: false, onHold: false, tuitions: [], parent: { id: 'p1', name: 'Saima Durrani' } }),
  'nf-clear': numberFirstOutcome({ msisdn: MSISDN, doNotUse: false, onHold: false, tuitions: [], parent: null }),
} as const

window.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('/api/admin/jobs/number-check')) {
    const outcome = OUTCOMES[which as keyof typeof OUTCOMES] ?? OUTCOMES['nf-clear']
    return new Response(JSON.stringify({ outcome }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterContext.Provider value={router as never}>
      <PathnameContext.Provider value="/admin">
        <SearchParamsContext.Provider value={new URLSearchParams() as never}>
          <ToastProvider>
            <ConfirmProvider>
              <AdminReadOnlyProvider readOnly={false}>{children}</AdminReadOnlyProvider>
            </ConfirmProvider>
          </ToastProvider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  )
}

function NumberFirstShot() {
  const [passed, setPassed] = React.useState(false)
  useEffect(() => {
    const t = setTimeout(() => (document.querySelector('form') as HTMLFormElement | null)?.requestSubmit(), 50)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="text-lg font-black text-tm-navy">Post a tuition</h1>
      <NumberFirstGate where="post" initialPhone="0300 9998877" onPassed={() => setPassed(true)} />
      {passed && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-3 text-xs font-semibold text-gray-600">
          The rest of the form opens here (level, subjects, city, area, fee…), with the number shown as “0300 •••• 877 · checked”.
        </p>
      )}
    </div>
  )
}

function EditTabShot() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-black text-tm-navy">Areeba Akhtar</h1>
      <MemberTabs memberId="00000000-0000-4000-8000-000000000001" current="edit" showProfile showEdit />
      <TutorFieldEditor
        tutorId="00000000-0000-4000-8000-000000000001"
        currentCity="Lahore"
        cnicNumberMasked="•••••-•••••••-4"
        currentName="Areeba Akhtar"
        slug="areeba-akhtar-tutor"
        canSlugEdit
      />
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Change history</h2>
        <ul className="space-y-1 text-xs text-slate-700">
          <li>
            <span className="font-bold">City</span> Karachi → Lahore · Staff — Hira Baig · 28 Oct 2026 · “Moved to Lahore”
          </li>
          <li>
            <span className="font-bold">Subjects</span> added Grade 9 · Physics · Staff — Hira Baig · 27 Oct 2026
          </li>
        </ul>
      </section>
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Retired addresses (1)</h2>
        <p className="text-xs">
          <span className="font-bold text-slate-700">/tutor/areeba-akhtar-tutor-3f2a</span> <span className="text-gray-500">→ current, since 12 Oct 2026</span>
        </p>
      </section>
    </div>
  )
}

function PaymentSettingsShot() {
  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Payment settings</h1>
        <p className="text-xs text-gray-500">Owner only. Every change needs your password and is recorded in the audit log.</p>
        <nav className="flex flex-wrap gap-2 pt-1">
          {PAYMENT_SETTINGS_SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-[36px] items-center rounded-full border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy">
              {s.label}
            </a>
          ))}
        </nav>
      </header>
      <section className="space-y-3">
        <h2 className="text-sm font-black text-tm-navy">Fee and plans switches</h2>
        <SwitchesForm initial={{ feeOpen: true, plansOpen: true }} />
        <OnboardingModeForm initial="everyone" />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-black text-tm-navy">Bank transfer details</h2>
        <GatewaysClient initial={{ active: 'paypro', methods: { paypro_online: false, bank_transfer: true }, payLater: false }} configured={{ paypro: true }} />
        <p className="rounded-xl bg-tm-tint-green p-3 text-[11px] font-bold text-tm-green-deep">Bank transfer is showing to members.</p>
        <BankDetailsForm initial={{ bankName: 'Example Bank', accountTitle: 'Example Company (Pvt) Ltd', accountNumber: '0000 1111 2222 3333', iban: 'PK00 EXAM 0000 1111 2222 3333', bankBranch: '', raastId: '', hasQr: false }} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-black text-tm-navy">Fee match range and bank email reader</h2>
        <FinanceSettingsView
          embedded
          s={{ status: 'running', lastRunAt: ago(4 * 60_000), lastSuccessAt: ago(4 * 60_000), lastError: null, emailsRead: 212, creditsAdded: 61, ignoredCount: 151, configured: true, missingEnv: [] }}
          cutoff="2026-11-25"
          red={false}
          switchNode={<ReaderSwitch enabled configured />}
          feeRangeNode={<FeeRangeForm min={199} max={210} price={199} />}
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-black text-tm-navy">PayPro settlement status</h2>
        <PayproSettlementCard pending={973} unsettled={6} oldest="2026-10-22" />
      </section>
    </div>
  )
}

function MessagingShot() {
  const days = [0, 1, 2].map((d) => new Date(NOW - d * D).toISOString().slice(0, 10))
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Messaging</h1>
        <p className="text-xs text-gray-500">Email (Resend), daily email usage by type, failures, and SMS. Read only, except the test SMS.</p>
      </header>
      <EmailHealthView
        h={{
          configured: true,
          sent24h: 31,
          sent7d: 214,
          failed7d: 1,
          skipped7d: 9,
          lastSentAt: ago(12 * 60_000),
          failures: [{ id: 'f1', at: ago(2 * D), mode: 'one', job: 'one', template: 'tuition_paused', recipient: 'ex•••@example.com', status: 'failed', attempts: 5, httpStatus: 503, error: 'Service unavailable' }],
          runs: [{ id: 'r1', job: 'tuition_paused', startedAt: ago(6 * H), finishedAt: ago(6 * H - 30_000), attempted: 18, delivered: 18, failed: 0, skipped: 0, requests: 1 }],
        }}
      />
      <EmailUsageView
        dailyLimit={100}
        rows={days.flatMap((day, i) => [
          { day, template: 'confirm_email', sent: 14 - i, skipped: 0, failed: 0, queued: 0, skipReasons: {} as Record<string, number> },
          { day, template: 'tuition_paused', sent: 18 + i, skipped: 2, failed: 0, queued: 0, skipReasons: { 'placeholder address': 2 } },
        ])}
      />
      <SmsHealthView
        canSend
        h={{
          provider: 'SendPK',
          settings: [
            { name: 'SENDPK_API_KEY', present: true },
            { name: 'SENDPK_SENDER', present: true },
            { name: 'SENDPK_TEMPLATE_ID', present: true },
            { name: 'SENDPK_BASE_URL', present: true },
          ],
          lastSuccessAt: ago(25 * 60_000),
          sent24h: 22,
          sent7d: 151,
          failed24h: 0,
          lastError: null,
          balance: { ok: true, pkr: 8240 },
          recent: [{ id: 's1', createdAt: ago(25 * 60_000), purpose: 'signup', toMasked: '0300•••••77', provider: 'sendpk', outcome: 'sent', messageId: 'm-001', error: null }],
          alerts: [],
        }}
      />
    </div>
  )
}

function SocialLinksShot() {
  const pages = socialPagesFrom({
    SOCIAL_FACEBOOK: 'https://www.facebook.com/example',
    SOCIAL_INSTAGRAM: 'https://www.instagram.com/example',
    SOCIAL_TIKTOK: 'https://www.tiktok.com/@example',
    SOCIAL_X: 'https://x.com/example',
  })
  const text = fillSocialLinks(SOCIAL_LINKS_DEFAULT, { firstName: 'Areeba', socialLinks: socialLinksBlock(pages, 'HIRA'), supportWhatsapp: '0321 5872222' })
  return (
    <div className="mx-auto max-w-md space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-[40px] items-center rounded-lg border border-tm-green-deep bg-white px-3 text-xs font-bold text-tm-green-deep">Send status image</span>
        <span className="inline-flex min-h-[40px] items-center rounded-lg border border-tm-navy bg-white px-3 text-xs font-bold text-tm-navy">Send social links</span>
      </div>
      <p className="text-[11px] font-bold text-gray-500">The WhatsApp message it opens (sender’s code HIRA; Instagram is sent without it):</p>
      <pre className="whitespace-pre-wrap rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-slate-800">{text}</pre>
    </div>
  )
}

const SHOTS: Record<string, () => React.ReactElement> = {
  'nf-dnu': NumberFirstShot,
  'nf-hold': NumberFirstShot,
  'nf-existing': NumberFirstShot,
  'nf-parent': NumberFirstShot,
  'nf-clear': NumberFirstShot,
  'edit-tab': EditTabShot,
  'payment-settings': PaymentSettingsShot,
  messaging: MessagingShot,
  'social-links': SocialLinksShot,
}
const Shot = SHOTS[which] ?? NumberFirstShot
createRoot(document.getElementById('root')!).render(
  <Providers>
    <Shot />
  </Providers>,
)
