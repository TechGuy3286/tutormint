// scripts/screenshot-oct26.tsx — HTML pages (and one PNG) for the 26 Oct 2026
// PR's screenshots, styled by the built site CSS, filled with INVENTED data only
// (no member's name, phone, email or account number): /pay/choose, the Verified
// status image (Story), a merge preview, Follow-ups → Parents and the View as
// banner. A signed-in session cannot be driven from a script.
//   npx tsx scripts/screenshot-oct26.tsx html <out-folder>
//   npx tsx --conditions=react-server scripts/screenshot-oct26.tsx png <out-folder>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'

async function main() {
  const mode = process.argv[2]
  const out = process.argv[3] ?? '.'
  if (mode === 'png') return png(out)
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime')
  const { ToastProvider } = await import('../components/ui/Toast')
  const { ConfirmProvider } = await import('../components/ui/ConfirmDialog')
  const { AdminReadOnlyProvider } = await import('../components/admin/ReadOnly')
  const { default: PayChoice } = await import('../app/(site)/pay/choose/PayChoice')
  const { default: ParentFollowUpsBoard } = await import('../app/admin/follow-ups/ParentFollowUpsBoard')
  const { MergePreviewView } = await import('../app/admin/users/merge/MergeClient')
  const { default: ViewAsBanner } = await import('../components/ViewAsBanner')

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

  // 1. /pay/choose — invented bank details, blurred.
  const bank = { bankName: 'Faysal Bank', accountTitle: 'Example Learning Pvt Ltd', accountNumber: '0000111122223333', iban: 'PK00FAYS0000111122223333', raastId: null }
  writeFileSync(
    join(out, 'pay-choose.html'),
    page(
      wrap(
        <div className="space-y-4">
          <nav className="text-xs text-gray-500">Home › Tutor dashboard › Payment</nav>
          <h1 className="text-xl font-black text-tm-navy">Complete your verification</h1>
          <section className="space-y-1.5 rounded-2xl border border-tm-navy/15 bg-tm-tint-navy p-4">
            <p className="text-sm font-black text-tm-navy">One-Time Verification Fee</p>
            <p className="text-xs leading-relaxed text-tm-navy">After verification, you can apply to tuitions and jobs and contact parents and employers directly.</p>
          </section>
          <PayChoice planCode="verified" isFee amount="Rs 199" bank={bank} receipt={{ state: 'none' }} waHref="https://wa.me/920000000000" />
          <button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-slate-700">← Back</button>
        </div>,
      ),
      380,
    ),
  )

  // 3. A merge preview — invented accounts.
  const sum = (id: string, name: string, completion: number, docs: number, paid: number) => ({
    id, name, role: 'tutor', joinedAt: '2026-10-20T10:00:00Z', completion, phoneMasked: '0300 •••• 000',
    documents: { count: docs, approved: docs ? ['CNIC'] : [] }, payments: { approved: paid, total: paid }, applications: 2, tuitions: 0,
  })
  const preview = {
    a: sum('a', 'Example Tutor', 87, 3, 1),
    b: sum('b', 'Example Tutor', 20, 0, 0),
    suggestedKeep: 'a',
    keepId: 'a',
    block: null,
    lines: ['Subjects: 2 items move', 'Applications: 1 item move', 'Timeline: 6 items move', 'Profile details: 1 field move'],
  }
  writeFileSync(join(out, 'merge-preview.html'), page(wrap(<MergePreviewView p={preview} keep="a" busy={false} onPick={() => {}} onMerge={() => {}} />), 760))

  // 4. Follow-ups → Parents — invented parents.
  const day = 86_400_000
  const now = Date.parse('2026-10-26T12:00:00Z')
  const st = (tab: 'todo' | 'sent', overdue = false, lastDays: number | null = null, action: { label: string; href: string } | null = null) => ({
    tab, section: tab, overdue, unanswered: 0, action,
    dueAt: tab === 'sent' && lastDays !== null ? new Date(now - lastDays * day + 3 * day).toISOString() : null,
    last: lastDays !== null ? { at: new Date(now - lastDays * day).toISOString(), progress: 'x', staffName: 'Staff A' } : null,
  })
  const cards = [
    { id: 'p1', name: 'Parent One', city: 'Lahore', joinedAt: '2026-10-18T09:00:00Z', reason: 'waiting_forward', tuition: { title: 'Home Tutor Required | Grade 5 | DHA, Lahore', path: '/tuitions/lahore/example' }, state: st('todo', false, null, { label: 'Tutors to forward', href: '#' }), hasNumber: true, hasEmail: false, notInterested: false },
    { id: 'p2', name: 'Parent Two', city: 'Karachi', joinedAt: '2026-10-15T09:00:00Z', reason: 'no_applicants', tuition: { title: 'Online Tutor Required | O Level Chemistry', path: '/tuitions/karachi/example' }, state: st('todo', true, 5), hasNumber: true, hasEmail: false, notInterested: false },
    { id: 'p3', name: 'Parent Three', city: 'Islamabad', joinedAt: '2026-10-22T09:00:00Z', reason: 'no_tuition', tuition: null, state: st('todo'), hasNumber: true, hasEmail: false, notInterested: false },
    { id: 'p4', name: 'Parent Four', city: 'Lahore', joinedAt: '2026-10-21T09:00:00Z', reason: 'email_unconfirmed', tuition: null, state: st('todo'), hasNumber: false, hasEmail: true, notInterested: false },
  ]
  const tabs = `<nav class="flex flex-wrap gap-1 border-b border-gray-200 mb-3"><span class="-mb-px min-h-[44px] border-b-2 border-tm-red px-3 py-2.5 text-xs font-bold text-tm-navy">To do <span class="text-gray-500">4</span></span><span class="-mb-px min-h-[44px] border-b-2 border-transparent px-3 py-2.5 text-xs font-bold text-gray-600">Followed up <span class="text-gray-500">2</span></span></nav>`
  writeFileSync(join(out, 'follow-ups-parents.html'), page(`<h2 class="mb-2 text-lg font-black text-tm-navy">Follow-ups → Parents</h2>${tabs}${wrap(<ParentFollowUpsBoard cards={cards as never} noReply={[]} />)}`, 900))

  // 5. The View as banner over a dashboard heading.
  writeFileSync(
    join(out, 'view-as-banner.html'),
    page(renderToStaticMarkup(<><ViewAsBanner name="Example Parent" /><h1 className="mt-4 text-xl font-black text-tm-navy">Parent dashboard</h1><p className="text-xs text-gray-600">Everything on this page is what the member sees. Changes are refused.</p></>), 390),
  )
  console.log('written')
}
async function png(out: string) {
  const { renderSocialBanner } = await import('../app/api/admin/social/image/render')
  const { silhouetteDataUri } = await import('../lib/social/avatars')
  const { brandMonogramDataUri } = await import('../lib/covers/assets')
  const { cvQrDataUri } = await import('../lib/cv/assets')
  // 2. The Verified status image (Story), an invented tutor with the grey silhouette.
  const profileUrl = 'https://www.tutormint.org/tutor/example-tutor'
  const res = renderSocialBanner({
    tutor: { id: '00000000-0000-4000-8000-000000000000', slug: 'example-tutor', full_name: 'Ayesha Example', headline: null, city: 'Lahore', area: null, rating_avg: null, rating_count: null, avatar_url: silhouetteDataUri('female'), experience_years: 4, teaching_mode: null, gender: 'female' },
    badges: ['Verified'],
    subjects: ['Grade 9–10 · English', 'O Level · Mathematics'],
    subjectParts: [{ level: 'Grade 9–10', subject: 'English' }, { level: 'O Level', subject: 'Mathematics' }],
    format: 'story',
    template: 'verified',
    qrDataUri: await cvQrDataUri(profileUrl),
    profileUrl,
    headline: '',
    logoDataUri: await brandMonogramDataUri(),
    verified: true,
  })
  writeFileSync(join(out, 'status-image-story.png'), Buffer.from(await res.arrayBuffer()))

  console.log('png written')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
