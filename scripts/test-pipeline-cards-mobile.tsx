/**
 * scripts/test-pipeline-cards-mobile.tsx — the compact People → Tutors cards at
 * 390 px (owner, 15 Nov 2026): no sideways scrolling of the page. Renders the
 * REAL card grid (search, stage chips, follow-up chips, cards) with INVENTED
 * data — a long name, a long city, a long rejection reason, every stage —
 * styles it with the built site CSS, loads it in headless Chrome at 390×844 and
 * measures that nothing reaches past the screen's right edge. The chip rows
 * scroll sideways inside themselves (that is the design), so their chips are
 * not counted; the page itself must not.
 *
 *   npm run build   (for the CSS)   then   npm run test:pipelinecards
 * Without a built CSS file or Chrome the render is skipped and says so.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import React from 'react'

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p))

async function main() {
  const cssDir = '.next/static/chunks'
  const cssFiles = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith('.css')) : []
  if (!cssFiles.length || !CHROME) {
    console.log(`– render check skipped (${!cssFiles.length ? 'no built CSS — run npm run build' : 'no Chrome'})`)
    return
  }
  const css = cssFiles.map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime')
  const { SearchParamsContext, PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime')
  const { ToastProvider } = await import('../components/ui/Toast')
  const { ConfirmProvider } = await import('../components/ui/ConfirmDialog')
  const { AdminReadOnlyProvider } = await import('../components/admin/ReadOnly')
  const { default: OverviewCardGrid } = await import('../components/admin/OverviewCardGrid')
  const { pipeCardFrom } = await import('../lib/tutorPipelineCardCore')
  const { FU_BUCKETS, FU_BUCKET_LABEL, PIPE_STAGES, STAGE_LABEL } = await import('../lib/tutorPipelineCore')

  const now = Date.parse('2026-11-16T06:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()
  const st = (s: 'approved' | 'waiting' | 'rejected' | 'none', reason: string | null = null) =>
    s === 'approved'
      ? { status: 'approved' as const, reason: null, hasUpload: true }
      : s === 'waiting'
        ? { status: 'pending' as const, reason, hasUpload: true }
        : s === 'rejected'
          ? { status: 'rejected' as const, reason, hasUpload: true }
          : { status: 'none' as const, reason: null, hasUpload: false }
  const longReason = 'The picture is too dark and the face is not clear enough to match the card, please retake in daylight'
  const variants = [
    { cnic: st('approved'), pic: st('approved'), fee: false, contacts: [] },
    { cnic: st('rejected', longReason), pic: st('approved'), fee: false, contacts: [{ at: iso(now - 3_600_000), kind: 'whatsapp' as const, stage: 'rejected' as const, docsApproved: null, staffName: 'Muhammad Abdul Rehman' }] },
    { cnic: st('waiting', 'Blurry'), pic: st('approved'), fee: false, contacts: [] },
    { cnic: st('none'), pic: st('waiting'), fee: false, contacts: [{ at: iso(now - 60_000), kind: 'call' as const, stage: null, docsApproved: null, staffName: 'Staff', attempt: 'no_answer' as const }] },
    { cnic: st('approved'), pic: st('approved'), fee: true, contacts: [] },
  ]
  const items = variants.map((v, i) => {
    const pipe = pipeCardFrom({
      name: 'Muhammad Abdul Rehman Siddiqui Qureshi Farooqi',
      feePaid: v.fee,
      completion: 94,
      mobileOk: true,
      docs: { statuses: { cnic: v.cnic, profilePic: v.pic, selfie: st('none') }, oldestUploadAt: iso(now - 86_400_000), approvedAt: iso(now - 3 * 86_400_000) },
      contacts: v.contacts,
      notInterested: false,
      paused: false,
      lastActiveAt: iso(now),
      support: '0300 0000000',
      nowMs: now,
    })
    return {
      id: `t${i}`,
      title: 'x',
      detail: null,
      href: null,
      amount: null,
      badge: null,
      actions: [],
      memberId: `00000000-0000-4000-8000-00000000000${i}`,
      reviewHref: `/admin/users/t${i}#documents`,
      member: {
        name: 'Muhammad Abdul Rehman Siddiqui Qureshi Farooqi',
        avatarUrl: null,
        gender: 'male',
        role: 'tutor' as const,
        city: 'Dera Ghazi Khan Cantonment Area',
        joinedAt: iso(now - 8 * 86_400_000),
        completion: 94,
        stoppedAt: null,
        paid: v.fee,
        badges: [],
        msisdn: '923000000000',
      },
      pipe: { card: pipe, links: { waHref: 'https://api.whatsapp.com/send?phone=923000000000&text=hi', chatHref: 'https://wa.me/923000000000', telHref: 'tel:+923000000000' } },
    }
  })
  const rows = [
    { param: 'stage', sqlParam: 'stages', label: 'Stage', keepFirst: true, options: [{ key: 'all', label: 'All' }, ...PIPE_STAGES.map((s) => ({ key: s, label: STAGE_LABEL[s] })), { key: 'reuploaded', label: 'Re-uploaded' }] },
    { param: 'fu', sqlParam: 'fus', label: 'Follow-up', options: FU_BUCKETS.map((b) => ({ key: b, label: FU_BUCKET_LABEL[b] })) },
  ]
  const rowCounts = { stage: Object.fromEntries(rows[0].options.map((o) => [o.key, 123])), fu: Object.fromEntries(rows[1].options.map((o) => [o.key, 45])) }
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }
  const body = renderToStaticMarkup(
    <AppRouterContext.Provider value={router as never}>
      <SearchParamsContext.Provider value={new URLSearchParams() as never}>
        <PathnameContext.Provider value="/admin/users">
          <ToastProvider>
            <ConfirmProvider>
              <AdminReadOnlyProvider readOnly={false} refCode="TEST" canApprove>
                <OverviewCardGrid
                  items={items as never}
                  filterRows={rows}
                  paged={{
                    basePath: '/admin/users',
                    keep: { tab: 'tutors' },
                    q: '',
                    sel: { stage: 'approved', fu: 'not' },
                    rowCounts,
                    docFilter: null,
                    docCounts: null,
                    shown: items.length,
                    total: 400,
                    searchedCount: 400,
                    allCount: 400,
                    noun: 'tutors',
                  }}
                />
              </AdminReadOnlyProvider>
            </ConfirmProvider>
          </ToastProvider>
        </PathnameContext.Provider>
      </SearchParamsContext.Provider>
    </AppRouterContext.Provider>,
  )
  if (!body.includes('data-pipe-card=""')) throw new Error('no compact card rendered')
  // Elements inside a sideways-scrolling chip row are allowed past the edge.
  const probe = `<script>addEventListener('load',()=>{const w=document.documentElement.clientWidth;const bad=[];for(const el of document.querySelectorAll('body *')){if(el.closest('[data-chip-row]')&&!el.hasAttribute('data-chip-row'))continue;const r=el.getBoundingClientRect();if(r.width&&r.right>w+0.5)bad.push(el.tagName+'.'+String(el.className).slice(0,60)+' right='+Math.round(r.right));}parent.document.title=JSON.stringify({w,sw:document.documentElement.scrollWidth,cards:document.querySelectorAll('[data-pipe-card]').length,bad:bad.slice(0,8)})})</script>`
  const inner = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>${probe}</head><body style="background:#F8FAFC;margin:0"><main class="mx-auto max-w-6xl px-4 py-5">${body}</main></body></html>`
  const esc = inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const dir = mkdtempSync(join(tmpdir(), 'tm-cards-'))
  const file = join(dir, 'cards.html')
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body style="margin:0"><iframe width="390" height="844" style="border:0;display:block" srcdoc="${esc}"></iframe></body></html>`)
  const out = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=600,900', '--virtual-time-budget=3000', '--dump-dom', `file:///${file.replace(/\\/g, '/')}`], { encoding: 'utf8', timeout: 60000 })
  const t = /<title>([^<]*)<\/title>/.exec(out)?.[1] ?? ''
  const m = JSON.parse(t.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as { w: number; sw: number; cards: number; bad: string[] }
  console.log(`  viewport ${m.w}px, page ${m.sw}px wide, ${m.cards} cards, ${m.bad.length} element(s) past the edge`)
  const problems: string[] = []
  if (m.w > 400) problems.push(`the window was not phone width (${m.w}px)`)
  if (m.cards !== items.length) problems.push(`expected ${items.length} cards, saw ${m.cards}`)
  if (m.sw > m.w) problems.push(`the page scrolls sideways (${m.sw} > ${m.w})`)
  problems.push(...m.bad)
  if (problems.length) {
    console.error('✖ horizontal overflow at 390 px:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  console.log('✔ compact tutor cards at 390 px: no horizontal overflow')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
