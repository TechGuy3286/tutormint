'use client'

import { useRef, useState } from 'react'
import { Check, Copy, Loader2, Upload } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import Link from 'next/link'
import { afterFeeReturnPath } from '@/lib/returnTo'
import { submitSignal, UPLOAD_TIMEOUT_MS } from '@/lib/submit'
import {
  RECEIPT_ACCEPT,
  RECEIPT_MESSAGES,
  receiptFileProblem,
  type BankDetails,
  type ReceiptState,
} from '@/lib/payments/receiptCore'
import { bankCopyRows, copyAllText, COPIED_MS } from '@/lib/payments/bankCopyCore'
import { PAY_BY_TRANSFER_LINE } from '@/lib/payments/payproRetireCore'

// The payment screen (owner, 11 Oct 2026; PayPro retired 26 Oct 2026).
//
// One way to pay: bank transfer. The bank panel shows the owner's account
// details, each on its own row with its own Copy button (numbers shown in
// groups of 4, copied without spaces — lib/payments/bankCopyCore), a
// "Copy all details" button, three short steps, and the receipt upload to
// /api/payments/receipt. No PayPro option is shown anywhere. Once a receipt is in, this renders the "received"
// status and nothing to pay with — the server refuses a second one too.

const URDU_FONT =
  "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Nafees Nastaleeq', 'Urdu Typesetting', 'Segoe UI', system-ui, sans-serif"

function Ur({ children }: { children: React.ReactNode }) {
  return (
    <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px] font-semibold" style={{ fontFamily: URDU_FONT }}>
      {children}
    </span>
  )
}

/** "English\nاردو" → the English line with the Urdu line under it. */
function TwoLine({ text }: { text: string }) {
  const [en, ur] = text.split('\n')
  return (
    <>
      {en}
      {ur && <Ur>{ur}</Ur>}
    </>
  )
}

/** Copy text, then show "Copied ✓" for two seconds. */
function useCopy(): [boolean, (text: string) => void] {
  const [done, setDone] = useState(false)
  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setDone(true)
        setTimeout(() => setDone(false), COPIED_MS)
      })
      .catch(() => {})
  }
  return [done, copy]
}

function CopyValue({ label, display, copy }: { label: string; display: string; copy: string }) {
  const [done, doCopy] = useCopy()
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5 last:border-0" data-copy-row={label}>
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</dt>
        <dd className="break-words font-mono text-base font-bold tracking-wide text-tm-navy" data-bank-value="">{display}</dd>
      </div>
      <button
        type="button"
        onClick={() => doCopy(copy)}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="inline-flex min-h-[48px] min-w-[88px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-slate-700 hover:border-tm-navy"
      >
        {done ? <Check aria-hidden size={16} className="text-tm-green-deep" /> : <Copy aria-hidden size={16} />}
        {done ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}

function CopyAll({ text }: { text: string }) {
  const [done, doCopy] = useCopy()
  return (
    <button
      type="button"
      onClick={() => doCopy(text)}
      className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-tm-navy bg-white px-4 text-sm font-bold text-tm-navy hover:bg-tm-tint-navy"
    >
      {done ? <Check aria-hidden size={16} className="text-tm-green-deep" /> : <Copy aria-hidden size={16} />}
      {done ? 'Copied ✓' : 'Copy all details'}
    </button>
  )
}

// The second way to pay (owner, 17 Oct 2026). Exported so the test can check them.
export const OTHER_METHODS_TITLE = 'Other methods'
export const OTHER_METHODS_SUB = 'Any bank app, Easypaisa or ATM transfer — activated after we check your receipt'
export const ANY_BANK_LINE = 'You can pay from any bank or wallet app. You don’t need a Faysal Bank account.'

export default function PayChoice({
  planCode,
  isFee,
  amount,
  bank,
  receipt,
  returnTo = null,
  waHref,
}: {
  planCode: string
  isFee: boolean
  /** The package price as text, from the plans row, passed by the page. Never typed here. */
  amount: string
  /** null = "Other methods" is not offered (switch off or details empty). */
  bank: BankDetails | null
  receipt: ReceiptState
  /** The tuition to go back to after paying the fee (owner, 15 Oct 2026). */
  returnTo?: string | null
  waHref: string
}) {
  const toast = useToast()
  // After a bank-transfer receipt: back to the tuition, with the note that
  // applying unlocks once the receipt is approved.
  const backToTuition = afterFeeReturnPath(returnTo, 'receipt')
  const [state, setState] = useState<ReceiptState>(receipt)
  const [file, setFile] = useState<File | null>(null)
  const [txn, setTxn] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const support = (
    <a
      href={waHref}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-green-deep"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the site's own WhatsApp mark */}
      <img src="/whatsapp.png" alt="" className="h-5 w-5" />
      Need help? WhatsApp us
    </a>
  )

  // A receipt is with staff: the status, and nothing to pay with.
  if (state.state === 'under_review') {
    return (
      <div className="space-y-3">
        <section role="status" className="rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4 text-xs font-bold leading-relaxed text-tm-gold-ink">
          <p className="text-sm font-black">Payment under review</p>
          <p className="mt-1">
            <TwoLine text={isFee ? RECEIPT_MESSAGES.received : RECEIPT_MESSAGES.receivedPlan} />
          </p>
        </section>
        {backToTuition && (
          <Link href={backToTuition}
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover">
            Back to the tuition
          </Link>
        )}
        {support}
      </div>
    )
  }

  if (!bank) {
    return (
      <div className="space-y-3">
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-slate-700">
          Payments are not available right now. Please try again later, or message us on WhatsApp.
          <Ur>ادائیگی ابھی دستیاب نہیں۔ کچھ دیر بعد کوشش کریں یا واٹس ایپ پر پیغام کریں۔</Ur>
        </p>
        {support}
      </div>
    )
  }

  const pick = (f: File | null) => {
    setError(f ? receiptFileProblem({ type: f.type, size: f.size }) : null)
    setFile(f)
  }

  const send = async () => {
    const problem = receiptFileProblem(file ? { type: file.type, size: file.size } : null)
    if (problem || !file) {
      setError(problem)
      return
    }
    setSending(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('planCode', planCode)
      form.set('receipt', file)
      form.set('transactionId', txn.trim())
      if (returnTo) form.set('returnTo', returnTo)
      const res = await fetch('/api/payments/receipt', { method: 'POST', body: form, signal: submitSignal(UPLOAD_TIMEOUT_MS) })
      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; code?: string; message?: string } | null
      if (res.ok && data?.success) {
        toast.success(data.message ?? RECEIPT_MESSAGES.received)
        setState({ state: 'under_review', paymentId: '', sentAt: new Date().toISOString() })
        return
      }
      if (data?.code === 'under_review') {
        setState({ state: 'under_review', paymentId: '', sentAt: new Date().toISOString() })
        return
      }
      setError(
        data?.error ??
          'Your receipt did not upload. Please try again, or message us on WhatsApp 0321 5872222.\nرسید اپ لوڈ نہیں ہوئی۔ دوبارہ کوشش کریں یا واٹس ایپ پر پیغام کریں۔',
      )
    } catch {
      setError('We could not reach TutorMint. Check your internet connection and try again.\nانٹرنیٹ کنکشن چیک کریں اور دوبارہ کوشش کریں۔')
    } finally {
      setSending(false)
    }
  }

  const option = (selected: boolean) =>
    `flex min-h-[56px] cursor-pointer items-center gap-3 rounded-2xl border bg-white p-4 ${
      selected ? 'border-tm-navy ring-1 ring-tm-navy' : 'border-gray-200'
    }`

  return (
    <div className="space-y-3">
      {state.state === 'rejected' && (
        <section role="alert" className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs leading-relaxed text-tm-red">
          <p className="font-black">We could not accept your receipt</p>
          <p className="mt-1 font-semibold">{state.reason}</p>
          <p className="mt-1 font-semibold">
            Please upload a new receipt below.
            <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px]" style={{ fontFamily: URDU_FONT }}>
              براہِ کرم نیچے نئی رسید اپ لوڈ کریں۔
            </span>
          </p>
        </section>
      )}

      {(
        <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4" data-bank-panel="">
          <h2 className="text-sm font-black text-tm-navy">Pay by bank transfer</h2>
          <p className="text-xs font-bold leading-relaxed text-tm-navy">{PAY_BY_TRANSFER_LINE}</p>
          <p className="text-xs leading-relaxed text-slate-700">{ANY_BANK_LINE}</p>
          <dl>
            {bankCopyRows(bank, amount).map((r) => (
              <CopyValue key={r.key} label={r.label} display={r.display} copy={r.copy} />
            ))}
          </dl>
          <CopyAll text={copyAllText(bank, amount)} />

          <ol className="space-y-1 text-xs leading-relaxed text-slate-700">
            <li>1. Send {amount} to this account from any bank app, JazzCash or Easypaisa.</li>
            <li>2. Take a screenshot of the receipt.</li>
            <li>3. Upload it below.</li>
            <li className="list-none">
              <Ur>کسی بھی بینک ایپ، جاز کیش یا ایزی پیسہ سے اس اکاؤنٹ میں رقم بھیجیں، رسید کا اسکرین شاٹ لیں اور نیچے اپ لوڈ کریں۔</Ur>
            </li>
          </ol>

          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept={RECEIPT_ACCEPT}
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-tm-navy/40 bg-tm-bg px-4 text-xs font-bold text-tm-navy"
            >
              <Upload aria-hidden size={16} />
              <span className="min-w-0 truncate">{file ? file.name : 'Upload receipt'}</span>
            </button>
            <p className="text-[11px] text-gray-500">A photo (JPG, PNG, WebP) or PDF, up to 5 MB.</p>

            <label className="block space-y-1">
              <span className="text-xs font-bold text-tm-navy">Transaction ID / reference (optional)</span>
              <input
                value={txn}
                onChange={(e) => setTxn(e.target.value)}
                maxLength={80}
                autoComplete="off"
                className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-sm text-slate-700 focus:border-tm-navy focus:outline-none"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl bg-tm-tint-red p-3 text-xs font-semibold leading-relaxed text-tm-red">
                <TwoLine text={error} />
              </p>
            )}

            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !file}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-tm-navy px-6 text-sm font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
            >
              {sending && <Loader2 aria-hidden size={16} className="animate-spin" />}
              {sending ? 'Sending…' : 'Send receipt'}
            </button>
          </div>

          {support}
        </section>
      )}
    </div>
  )
}
