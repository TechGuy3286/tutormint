// scripts/screenshot-payments.tsx — writes two HTML pages styled by the built
// site CSS, for screenshots (a signed-in session cannot be driven from a
// script): the payment screen's bank panel (with INVENTED bank details, blurred)
// and Finance → Settings with the bank email reader switch (the live reader
// status and PayPro cut-off). Never reads or prints a real bank detail.
// Two steps, because the loader needs the react-server condition:
//   npx tsx --conditions=react-server --env-file=.env.local scripts/screenshot-payments.tsx state <state.json>
//   npx tsx scripts/screenshot-payments.tsx html <state.json> <out-folder>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const [mode, stateFile, out = '.'] = process.argv.slice(2)
  if (mode === 'state') {
    const { loadReaderState } = await import('../lib/bankEmailReader')
    const { loadPayproCutoff } = await import('../lib/payments/payproCutoff')
    const s = await loadReaderState()
    const cutoff = await loadPayproCutoff()
    writeFileSync(stateFile, JSON.stringify({ s, cutoff }))
    console.log(`reader: ${s.enabled ? 'on' : 'off'} · status ${s.status} · configured ${s.configured} · cut-off ${cutoff}`)
    process.exit(0)
  }
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { ToastProvider } = await import('../components/ui/Toast')
  const { default: PayChoice } = await import('../app/(site)/pay/choose/PayChoice')
  const { default: FinanceSettingsView } = await import('../app/admin/finance/settings/FinanceSettingsView')
  const { s, cutoff } = JSON.parse(readFileSync(stateFile, 'utf8'))
  const cssDir = '.next/static/chunks'
  const css = readdirSync(cssDir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n')
  const page = (body: string, width: number) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
[data-bank-value]{filter:blur(6px)}</style></head><body style="background:#F8FAFC;margin:0;padding:16px"><div style="max-width:${width}px;margin:0 auto;box-sizing:border-box">${body}</div></body></html>`

  // Invented details only — never the owner's.
  const bank = { bankName: 'Faysal Bank', accountTitle: 'Example Learning Pvt Ltd', accountNumber: '0000111122223333', iban: 'PK00FAYS0000111122223333', raastId: '03000000000' }
  const choice = renderToStaticMarkup(
    <ToastProvider>
      <h1 className="mb-3 text-xl font-black text-tm-navy">Complete your verification</h1>
      <PayChoice planCode="verified" isFee amount="Rs 199" bank={bank} receipt={{ state: 'none' }} waHref="https://wa.me/923215872222" />
    </ToastProvider>,
  )
  writeFileSync(join(out, 'pay-choose.html'), page(choice, 380))

  const switchNode = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
      <span className="text-xs font-bold text-tm-navy">Bank email reader is {s.enabled ? 'on' : 'off'}</span>
      <button type="button" className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-navy px-5 text-xs font-bold text-white">
        {s.enabled ? 'Switch off' : 'Switch on'}
      </button>
    </div>
  )
  writeFileSync(join(out, 'finance-settings.html'), page(renderToStaticMarkup(<FinanceSettingsView s={s} cutoff={cutoff} red={false} switchNode={switchNode} />), 640))
}
main()
