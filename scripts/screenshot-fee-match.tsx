// scripts/screenshot-fee-match.tsx — HTML pages for the 27 Oct 2026 payment
// auto-linking PR's screenshots, rendered from the real components and styled
// by the built site CSS, filled with INVENTED data only (no member's name,
// phone, email or account number). A signed-in session cannot be driven from
// a script.
//   npx tsx scripts/screenshot-fee-match.tsx <out-folder>
// then capture each .html with headless Chrome.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'

async function main() {
  const out = process.argv[2] ?? '.'
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime')
  const { SearchParamsContext, PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime')
  const { ToastProvider } = await import('../components/ui/Toast')
  const { ConfirmProvider } = await import('../components/ui/ConfirmDialog')
  const { AdminReadOnlyProvider } = await import('../components/admin/ReadOnly')
  const { default: AlreadyPaidOptions } = await import('../components/admin/AlreadyPaidOptions')
  const { default: SettlementsBoard } = await import('../app/admin/finance/settlement/SettlementsBoard')
  const { buildBoard, monthView } = await import('../lib/settlementMatchCore')
  const { financeCards, financeCounts, financeItems } = await import('../lib/financeItemsCore')
  const { autoLinkPlan, FEE_MATCH_DEFAULT } = await import('../lib/feeMatchCore')
  const { fillParentFollowUp, PARENT_DEFAULTS } = await import('../lib/parentFollowUpCore')
  const { finishWaText, siteLink, waSendHref } = await import('../lib/waLinkCore')

  const cssDir = '.next/static/chunks'
  const css = readdirSync(cssDir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n')
  const page = (body: string, width: number) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#F8FAFC;margin:0;padding:16px"><div style="max-width:${width}px;margin:0 auto;box-sizing:border-box">${body}</div></body></html>`
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }
  const wrap = (node: React.ReactNode) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider value={router as never}>
        <SearchParamsContext.Provider value={new URLSearchParams() as never}>
        <PathnameContext.Provider value="/admin/finance">
        <ToastProvider>
          <ConfirmProvider>
            <AdminReadOnlyProvider readOnly={false} refCode="AQSA" canApprove>
              {node}
            </AdminReadOnlyProvider>
          </ConfirmProvider>
        </ToastProvider>
        </PathnameContext.Provider>
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>,
    )
  const save = (name: string, body: string, width: number) => writeFileSync(join(out, name), page(body, width))

  // 1. "This member has already paid this fee" — both options.
  save(
    'already-paid-options.html',
    wrap(
      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
          <p className="text-xs font-bold text-tm-navy">Who paid this, and for what?</p>
          <p className="text-xs text-slate-700">Member: <span className="font-bold">Zara Imtiaz</span></p>
          <p role="alert" className="rounded-xl bg-tm-tint-red p-2 text-xs font-bold text-tm-red">This member has already paid this fee.</p>
          <AlreadyPaidOptions
            existing={{ paymentId: 'p1', ref: 'TM-DEMO1234-AB12CD34EF56', amountPkr: 199, approvedAt: '2026-10-26T09:30:00Z', provider: 'manual', hasCredit: false }}
            option="link_existing"
            transferId="t1"
            memberId="m1"
            memberName="Zara Imtiaz"
            creditAmountPkr={200}
            onDone={() => {}}
          />
        </div>
        <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
          <p className="text-xs font-bold text-tm-navy">Who paid this, and for what?</p>
          <p className="text-xs text-slate-700">Member: <span className="font-bold">Omar Farooq</span></p>
          <p role="alert" className="rounded-xl bg-tm-tint-red p-2 text-xs font-bold text-tm-red">This member has already paid this fee.</p>
          <AlreadyPaidOptions
            existing={{ paymentId: 'p2', ref: 'TM-DEMO5678-0099AABBCCDD', amountPkr: 199, approvedAt: '2026-10-25T11:00:00Z', provider: 'manual', hasCredit: true }}
            option="refund_due"
            transferId="t2"
            memberId="m2"
            memberName="Omar Farooq"
            creditAmountPkr={200}
            onDone={() => {}}
          />
        </div>
      </div>,
    ),
    420,
  )

  // 2. A parent WhatsApp message preview (Tutors applied), as the parent sees it.
  const text = finishWaText(
    fillParentFollowUp(PARENT_DEFAULTS.pf_tutors_applied, {
      firstName: 'Sana',
      tuitionTitle: 'Home Tutor Required | Grade 6 | Gulberg, Lahore',
      postLink: siteLink('/parent/dashboard/post-job'),
      tutorLinks: [siteLink('/tutor/demo-tutor-one'), siteLink('/tutor/demo-tutor-two'), siteLink('/tutor/demo-tutor-three')],
      supportWhatsapp: '0321 5872222',
    }),
    'AQSA',
  )
  const href = waSendHref('923000000000', text)
  save(
    'parent-whatsapp-preview.html',
    wrap(
      <div className="space-y-3">
        <p className="text-xs font-bold text-tm-navy">WhatsApp parent — message preview (Tutors applied)</p>
        <div className="rounded-2xl bg-tm-tint-green p-3 text-[13px] leading-relaxed text-slate-900 shadow-sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text}
        </div>
        <p className="break-all text-[10px] text-gray-500">Opens: {href.slice(0, 120)}…</p>
      </div>,
    ),
    380,
  )

  // 3. Finance → Needs attention after the clean-up (invented credits).
  const credits = [
    { id: 'c1', date: '2026-10-26', time: '15:10', amountPkr: 200, senderName: 'ZARA IMTIAZ', senderBank: 'Meezan Bank', reference: 'DEMO000111', note: null, isPaypro: false, source: 'email' as const },
    { id: 'c2', date: '2026-10-27', time: '11:00', amountPkr: 200, senderName: 'Hina Tar', senderBank: null, reference: 'DEMO000222', note: null, isPaypro: false, source: 'manual' as const },
    { id: 'c3', date: '2026-10-25', time: '10:00', amountPkr: 110, senderName: 'FAIZAN ALI', senderBank: null, reference: 'DEMO000333', note: null, isPaypro: false, source: 'email' as const },
    { id: 'c4', date: '2026-10-22', time: null, amountPkr: 200, senderName: 'NOOR UL AIN', senderBank: null, reference: 'DEMO000444', note: null, isPaypro: false, source: 'manual' as const },
    { id: 'c5', date: '2026-10-20', time: null, amountPkr: 10000, senderName: 'DEMO PARTNER', senderBank: null, reference: 'DEMO000555', note: null, isPaypro: true, source: 'manual' as const, category: 'owner_transfer' },
  ]
  const receipts = [
    { id: 'r1', ref: 'TM-DEMO-R1', amountPkr: 199, approvedDay: '2026-10-26', transactionId: null, payerName: 'Zara Imtiaz', planCode: 'verified', memberId: 'm1', createdAt: '2026-10-26T09:00:00Z', reviewedAt: '2026-10-26T09:10:00Z' },
    { id: 'r2', ref: 'TM-DEMO-R2', amountPkr: 199, approvedDay: '2026-10-27', transactionId: null, payerName: 'Hina Tariq', planCode: 'verified', memberId: 'm2', createdAt: '2026-10-27T05:00:00Z', reviewedAt: '2026-10-27T05:05:00Z' },
  ]
  const board = buildBoard({ rows: [], credits, ourPaypro: [], receipts, links: [], nowIso: '2026-10-27T18:00:00Z', feeRange: FEE_MATCH_DEFAULT })
  const free = board.credits.filter((c) => c.state === 'unmatched' && !c.isPaypro)
  const open = board.receipts.filter((r) => r.state === 'waiting').map((r) => ({ id: r.id, ref: r.ref, memberId: r.memberId ?? null, memberName: r.payerName, amountPkr: r.amountPkr, createdAt: r.createdAt ?? null, reviewedAt: r.reviewedAt ?? null }))
  const plan = autoLinkPlan(free, open, FEE_MATCH_DEFAULT)
  const hints: Record<string, never> = {} as never
  const h = hints as unknown as Record<string, unknown>
  for (const s of plan.suggestions) h[s.creditId] = { kind: 'suggest', paymentId: s.paymentId, paymentRef: s.paymentRef, memberId: s.memberId, memberName: s.memberName }
  h.c3 = { kind: 'partial', short: 89, memberId: 'm3', memberName: 'Faizan Ali' }
  h.c1 = { kind: 'rounding', rounding: 1 }
  const view = monthView(board, [], '2026-10')
  const refunds = [{ id: 'rd1', memberId: 'm9', memberName: 'Omar Farooq', transferId: 'x', paymentId: null, paymentRef: 'TM-DEMO5678-0099AABBCCDD', amountPkr: 200, note: null, createdAt: '2026-10-27T12:00:00Z', createdByName: 'Owner', refundedAt: null }]
  const data = {
    view,
    hasExport: false,
    latestUpload: null,
    openOrders: [],
    openReceipts: [],
    receiptRefs: Object.fromEntries(board.receipts.map((r) => [r.id, r.ref])),
    hints: h,
    refunds,
  }
  save(
    'needs-attention-after-cleanup.html',
    (() => {
      const items = financeItems(view, [], h as never, refunds)
      const shown = items.filter((i) => i.group === 'attention')
      return wrap(<SettlementsBoard data={data as never} items={shown} itemsTotal={shown.length} counts={financeCounts(items)} cards={financeCards(view, items)} group="attention" />)
    })(),
    760,
  )
  console.log('written to', out)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
