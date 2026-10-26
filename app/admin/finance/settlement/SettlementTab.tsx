import type { ReactNode } from 'react'

import { loadGatewayHealth } from '@/lib/payments/gatewaySettings'
import { loadSettlement, type SettlementView } from '@/lib/settlement'
import { loadSettlementsBoard } from '@/lib/settlementMatch'
import { financeItems } from '@/lib/financeItemsCore'
import { pkDayKey } from '@/lib/datetime'
import Link from 'next/link'
import { loadOpenFinanceAlerts } from '@/lib/financeAlerts'
import { loadReaderState } from '@/lib/bankEmailReader'
import { readerFailingAlert, READER_STATUS_LABEL } from '@/lib/bankEmailCore'
import SettlementCheck from './SettlementCheck'
import SettlementsBoard from './SettlementsBoard'

// The body of Admin → Finance (owner, 21 Oct 2026: the Finance and Settlement
// check tabs became one page with one month picker). OWNER ONLY plus the
// view-only Partner (SCREEN_ACCESS.finance — checked by the Finance page that
// renders this).
//
// The board shows the three cards, the two filters and the month's items; the
// range check and deduction lines per gateway (6–8 Oct 2026, unchanged) and the
// totals passed in as `extra` sit inside its closed "Show details" section. The
// old URLs (/admin/finance/settlement, ?tab=settlement,
// /admin/payments/reconciliation) redirect to /admin/finance.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function SettlementTab({ sp, extra }: { sp: { from?: string; to?: string; month?: string; show?: string }; extra?: ReactNode }) {
  const today = pkDayKey(new Date())
  const month = sp.month && ISO_MONTH.test(sp.month) ? sp.month : today.slice(0, 7)
  const ranged = !!(sp.from && ISO_DAY.test(sp.from) && sp.to && ISO_DAY.test(sp.to))
  let from = sp.from && ISO_DAY.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`
  let to = sp.to && ISO_DAY.test(sp.to) ? sp.to : today
  if (from > to) [from, to] = [to, from]

  const [board, health, alerts, reader] = await Promise.all([loadSettlementsBoard(month), loadGatewayHealth(), loadOpenFinanceAlerts(), loadReaderState()])
  const readerRed = readerFailingAlert(reader, new Date())
  const views: { id: string; name: string; view: SettlementView }[] = []
  for (const g of health.gateways) {
    if (!g.connected) continue
    const v = await loadSettlement(g.id, from, to)
    if (v) views.push({ id: g.id, name: g.name, view: v })
  }

  const rangeCheck = (
    <section className="space-y-3">
      <p className="text-sm font-black text-tm-navy">Range check and deduction lines</p>
      <div className="mx-auto max-w-xl space-y-6">
        {views.length === 0 ? (
          <p className="text-xs text-gray-500">No payment gateway is connected.</p>
        ) : (
          views.map((v) => (
            <section key={v.id} className="space-y-2">
              <p className="text-sm font-bold text-tm-navy">{v.name}</p>
              <SettlementCheck view={v.view} gatewayName={v.name} />
            </section>
          ))
        )}
      </div>
    </section>
  )

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Finance</h1>
        <p className="text-xs text-gray-500">What customers paid, and what has reached the bank — Pakistan time.</p>
        <p className="text-xs">
          <Link href="/admin/finance/settings" className="font-bold text-tm-red underline">Finance settings</Link>
          <span className="text-gray-500"> · Bank email reader: {READER_STATUS_LABEL[reader.status]}</span>
        </p>
      </header>

      {readerRed && (
        <section role="alert" className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red" data-reader-alert="">
          The bank email reader has not worked for over an hour ({reader.lastError ?? READER_STATUS_LABEL[reader.status]}). New bank credits are not being added.{' '}
          <Link href="/admin/finance/settings" className="underline">Open Finance settings</Link>
        </section>
      )}

      {board ? (
        <SettlementsBoard
          key={month}
          data={board}
          items={financeItems(board.view, alerts)}
          detailsOpen={ranged || sp.show === 'details'}
          details={
            <>
              {rangeCheck}
              {extra}
            </>
          }
        />
      ) : (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">Finance could not be loaded right now. Please reload the page.</p>
      )}
    </div>
  )
}
