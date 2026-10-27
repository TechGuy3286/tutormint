// scripts/screenshot-consent.tsx — HTML pages for the 27 Oct 2026 consent PR's
// screenshots, rendered from the real components and styled by the built site
// CSS, filled with INVENTED data only (no member's name, phone, email or
// account number). A signed-in session cannot be driven from a script.
//   npx tsx scripts/screenshot-consent.tsx <out-folder>
// then capture each .html with headless Chrome.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'

async function main() {
  const out = process.argv[2] ?? '.'
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime')
  const { ToastProvider } = await import('../components/ui/Toast')
  const { ConfirmProvider } = await import('../components/ui/ConfirmDialog')
  const { AdminReadOnlyProvider } = await import('../components/admin/ReadOnly')
  const { default: ConsentBox } = await import('../components/forms/ConsentBox')
  const { default: ConsentChip } = await import('../components/admin/ConsentChip')
  const { default: ReportTargetBlock } = await import('../components/admin/ReportTargetBlock')
  const { default: JobCard } = await import('../components/JobCard')
  const { default: PayChoice } = await import('../app/(site)/pay/choose/PayChoice')
  const { HIDDEN_CONTACT_LINE } = await import('../lib/tuitionConsentCore')
  const { TEAM_POSTER_LABEL } = await import('../lib/teamPosterCore')

  const cssDir = '.next/static/chunks'
  const css = readdirSync(cssDir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n')
  const page = (body: string, width: number) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
[data-bank-value]{filter:blur(6px)}</style></head><body style="background:#F8FAFC;margin:0;padding:16px"><div style="max-width:${width}px;margin:0 auto;box-sizing:border-box">${body}</div></body></html>`
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }
  const wrap = (node: React.ReactNode) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider value={router as never}>
        <ToastProvider>
          <ConfirmProvider>
            <AdminReadOnlyProvider readOnly={false} refCode={null} canApprove>
              {node}
            </AdminReadOnlyProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AppRouterContext.Provider>,
    )
  const save = (name: string, body: string, width: number) => writeFileSync(join(out, name), page(body, width))

  // 1. Post a tuition — the consent box (staff block), invented values.
  save(
    'post-a-tuition-consent.html',
    wrap(
      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-black text-tm-navy">Your advert · staff details</p>
        <ConsentBox value={{ agreed: true, method: 'phone', note: 'Spoke to the mother on 27 Oct' }} onChange={() => {}} />
        <label className="block space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Origin (for the audit trail)</span>
          <select className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy"><option>Support request</option></select>
        </label>
      </div>,
    ),
    420,
  )

  // 2. The "Consent not recorded" chip with Ask parent, on an admin tuition card.
  save(
    'consent-chip.html',
    wrap(
      <ul className="space-y-3">
        <li className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-tm-tint-navy px-1.5 py-0.5 text-[11px] font-black tabular-nums text-tm-navy">TM-9001</span>
            <span className="text-sm font-black text-tm-navy">Home Tutor Required | Grade 5 | Model Town | Lahore</span>
          </div>
          <p className="text-[11px] text-gray-500">TutorMint team · Model Town, Lahore · Grade 5 · 2 applied · 1 forwarded</p>
          <ConsentChip jobId="00000000-0000-4000-8000-000000009001" recorded={false} hasNumber />
        </li>
        <li className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-tm-tint-navy px-1.5 py-0.5 text-[11px] font-black tabular-nums text-tm-navy">TM-9002</span>
            <span className="text-sm font-black text-tm-navy">Online Tutor Required | O Level Physics | Karachi</span>
          </div>
          <ConsentChip jobId="00000000-0000-4000-8000-000000009002" recorded label="Recorded — WhatsApp" />
        </li>
      </ul>,
    ),
    600,
  )

  // 3. The tutor's view of a tuition with a hidden number (the card + the page's contact line).
  const job = {
    id: '00000000-0000-4000-8000-000000009003',
    job_tx_id: 'JOB-EXAMPLE',
    ref_id: 'TM-9003',
    public_slug: 'home-tutor-required-example-abc123',
    status: 'open',
    title: 'Female Home Tutor for Grade 7 in Gulberg, Lahore',
    headline: 'Female Home Tutor Required | Grade 7 | Gulberg | Lahore',
    description: 'Maths and Science, five days a week in the evening.',
    subjects: ['Mathematics', 'General Science'],
    class_level: 'Grade 7',
    city: 'Lahore',
    area: 'Gulberg',
    teaching_mode: 'Home Tutor',
    budget_pkr: 15000,
    budget_min_pkr: 10000,
    budget_max_pkr: 20000,
    created_at: '2026-10-26T08:00:00Z',
    parent_id: '00000000-0000-4000-8000-000000009999',
    parent_name: 'TutorMint',
    parent_badges: [],
    parent_can_hire: true,
    posted_by_team: true,
    contactTeaser: null,
    contactHidden: true,
    gender_preference: 'female',
  }
  save(
    'tutor-view-hidden-number.html',
    wrap(
      <div className="space-y-4">
        <JobCard job={job as never} signedIn showApply />
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-tm-tint-navy px-3 py-1 text-xs font-black text-tm-navy">{TEAM_POSTER_LABEL}</p>
          <h1 className="text-xl font-black leading-snug text-tm-navy">Female Home Tutor Required | Grade 7 | Gulberg | Lahore</h1>
          <p className="rounded-xl bg-tm-tint-navy px-3 py-2 text-sm font-semibold text-tm-navy">{HIDDEN_CONTACT_LINE}</p>
          <button type="button" className="min-h-[48px] w-full rounded-xl bg-tm-red px-6 text-sm font-bold text-white">Apply</button>
        </section>
      </div>,
    ),
    420,
  )

  // 4. A report card.
  save(
    'report-card.html',
    wrap(
      <ul className="space-y-3">
        <li className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-black text-tm-navy">
                Problem with this job: already filled<span className="ml-2 text-[11px] font-semibold text-gray-500">on a job</span>
              </p>
              <p className="text-[11px] text-gray-500">Ayesha Example reported a tuition (no member named) · 27 Oct 2026, 11:20 am</p>
            </div>
            <span className="shrink-0 rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-tm-gold-ink">open</span>
          </div>
          <ReportTargetBlock
            target={{
              kind: 'tuition',
              jobId: '00000000-0000-4000-8000-000000009003',
              refId: 'TM-9003',
              title: 'Female Home Tutor Required | Grade 7 | Gulberg | Lahore',
              adminHref: '/admin/jobs/00000000-0000-4000-8000-000000009003',
              publicHref: '/tuitions/lahore/home-tutor-required-example-abc123',
              postedByTeam: true,
            }}
            reporter={{ role: 'tutor', feePaid: true, verified: true, mobileVerified: true }}
            applications={[{ stage: 'forwarded', appliedAt: '2026-10-26T09:00:00Z', withdrawn: false }]}
          />
          <p className="rounded-xl bg-tm-bg p-3 text-xs leading-relaxed">The parent said they already found a tutor.</p>
        </li>
      </ul>,
    ),
    600,
  )

  // 5. /pay/choose — invented bank details, blurred; no receipt yet (Submit grey).
  const bank = { bankName: 'Faysal Bank', accountTitle: 'Example Learning Pvt Ltd', accountNumber: '0000111122223333', iban: 'PK00FAYS0000111122223333', raastId: null }
  save(
    'pay-choose.html',
    wrap(
      <div className="space-y-4">
        <nav className="text-xs text-gray-500">Home › Tutor dashboard › Payment</nav>
        <h1 className="text-xl font-black text-tm-navy">Complete your verification</h1>
        <PayChoice planCode="verified" isFee amount="Rs 199" bank={bank} receipt={{ state: 'none' }} />
        <button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-slate-700">← Back</button>
      </div>,
    ),
    380,
  )
  console.log('written to', out)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
