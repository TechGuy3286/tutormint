import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { hiddenNumberCount } from '@/lib/tuitionConsent'
import { HIDE_NUMBERS_LABEL, HIDDEN_CONTACT_LINE } from '@/lib/tuitionConsentCore'
import HideNumbersSwitch from './HideNumbersSwitch'

// Admin → Settings → Privacy (owner, 27 Oct 2026). The Owner's switch "Hide
// parent numbers when consent isn't recorded" (ON by default). The Owner
// changes it; the Partner views; everyone else is sent away.

export const dynamic = 'force-dynamic'

export default async function PrivacySettingsPage() {
  await requireAdminRole(...SCREEN_ACCESS.consentPrivacy)
  const { hidden, switchOn } = await hiddenNumberCount()

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Privacy</h1>
        <p className="text-xs text-gray-500">Parent numbers on tuitions where we have not recorded the parent’s consent to be listed.</p>
      </header>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-black text-tm-navy">{HIDE_NUMBERS_LABEL}</h2>
        <p className="text-xs leading-relaxed text-slate-700">
          When this is on, for a tuition whose consent is Not recorded: tutors can still apply, but the parent’s number is never
          shown — not by “View number”, and not to a tutor who viewed it before. In place of the number they see “{HIDDEN_CONTACT_LINE}”,
          and no reveal is counted. Staff then forward applicants through Applications as normal. Public pages never show a parent’s
          number either way.
        </p>
        <p className="text-xs font-bold text-slate-800" data-hidden-count={hidden}>
          {switchOn
            ? `${hidden} open or paused ${hidden === 1 ? 'tuition has' : 'tuitions have'} the number hidden now.`
            : 'Off: every tuition’s number can be viewed by tutors as before.'}
        </p>
        <HideNumbersSwitch on={switchOn} />
      </section>
    </div>
  )
}
