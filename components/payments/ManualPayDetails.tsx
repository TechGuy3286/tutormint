import type { ManualInstructions } from '@/lib/payments/provider'

// The bank / JazzCash / Easypaisa account details shown directly below the PayPro
// button on a payment screen (PR106-E §2). Presentational (no hooks) so a server
// page and a client gate can both render it. The numbers come ONLY from the
// passed `instructions` (lib/payments/manual manualInstructions → app_settings) —
// the same source /pay/manual uses; nothing is copied or hard-coded here.
//
// A channel with no details is simply not listed (manualInstructions returns null
// for it). When nothing is configured the block renders only the bank-transfer
// link + the plain activation line, so the member still has a way through.

export default function ManualPayDetails({
  instructions,
  transferHref,
  onTransfer,
}: {
  instructions: ManualInstructions
  /** Link to the order page to submit proof (server render). */
  transferHref?: string
  /** Or a click handler that starts a transfer checkout (client gate). */
  onTransfer?: () => void
}) {
  const i = instructions
  const bank = i.iban || i.accountNumber
  const rows: { label: string; value: string }[] = []
  if (i.jazzcash) rows.push({ label: 'JazzCash', value: i.jazzcash })
  if (i.easypaisa) rows.push({ label: 'Easypaisa', value: i.easypaisa })
  if (bank) rows.push({ label: i.bankName ? `Bank — ${i.bankName}` : 'Bank', value: bank })

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-tm-bg p-3">
      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">
        Or pay by bank transfer
        <span lang="ur" dir="rtl" className="ms-1.5 font-semibold normal-case tracking-normal">یا بینک ٹرانسفر سے</span>
      </p>

      {rows.length > 0 ? (
        <dl className="space-y-1">
          {i.accountTitle && (
            <div className="flex justify-between gap-3 text-[12px]">
              <dt className="text-gray-500">Account title</dt>
              <dd className="font-bold text-tm-navy">{i.accountTitle}</dd>
            </div>
          )}
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3 text-[12px]">
              <dt className="text-gray-500">{r.label}</dt>
              <dd className="font-mono font-bold text-tm-navy">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[11px] text-gray-500">Bank transfer details will be shown on the next step.</p>
      )}

      {transferHref ? (
        <a href={transferHref} className="inline-flex min-h-[40px] items-center text-[12px] font-bold text-tm-navy underline-offset-2 hover:underline">
          Pay by bank transfer (submit proof)
        </a>
      ) : onTransfer ? (
        <button type="button" onClick={onTransfer} className="min-h-[40px] text-[12px] font-bold text-tm-navy underline-offset-2 hover:underline">
          Pay by bank transfer (submit proof)
        </button>
      ) : null}

      <p className="text-[11px] text-gray-500">
        Bank transfer is activated after our team checks your payment.
        <span lang="ur" dir="rtl" className="mt-0.5 block">بینک ٹرانسفر ہماری ٹیم کے جانچنے کے بعد چالو ہوتی ہے۔</span>
      </p>
    </div>
  )
}
