'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, Pencil } from 'lucide-react'

import CvPreview from '@/components/cv/CvPreview'
import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'
import { toCvModel, type CvRaw, type CvTemplate } from '@/lib/cv/model'

// The CV page's interactive shell. The preview is live for EVERY tutor (free
// included); only the PDF download is gated at Verified. Template and the
// contact toggle re-run the same pure mapper the PDF route uses, so the preview
// on screen is exactly what downloads.

const TEMPLATES: { code: CvTemplate; label: string }[] = [
  { code: 'classic', label: 'Classic' },
  { code: 'minimal', label: 'Minimal' },
]

export default function CvClient({
  raw,
  qrDataUrl,
  canDownload,
  completion,
}: {
  raw: CvRaw
  qrDataUrl: string
  canDownload: boolean
  completion: number
}) {
  const [template, setTemplate] = useState<CvTemplate>('classic')
  const [includeContact, setIncludeContact] = useState(true)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const model = useMemo(() => toCvModel(raw, { includeContact }), [raw, includeContact])

  const download = async () => {
    setBusy(true)
    try {
      const params = new URLSearchParams({ template, contact: includeContact ? '1' : '0' })
      const res = await fetch(`/api/tutor/cv/pdf?${params}`, { signal: submitSignal() })
      if (!res.ok) throw new Error('That download did not go through. Please try again.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${model.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-Tutor-CV-TutorMint.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('CV downloaded.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not download your CV.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls — never part of the printable preview below. */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl border border-gray-200 p-0.5" role="tablist" aria-label="CV template">
            {TEMPLATES.map((t) => (
              <button
                key={t.code}
                type="button"
                role="tab"
                aria-selected={template === t.code}
                onClick={() => setTemplate(t.code)}
                className={`min-h-[40px] rounded-lg px-4 text-xs font-bold transition-colors ${
                  template === t.code ? 'bg-tm-navy text-white' : 'text-tm-navy hover:bg-tm-bg'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs font-bold text-tm-navy">
            <input
              type="checkbox"
              checked={includeContact}
              onChange={(e) => setIncludeContact(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-tm-navy focus:ring-tm-navy"
            />
            Include my contact details
          </label>
        </div>

        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
          Your CV is built from your profile — nothing here is edited on this page.
          <Link href="/tutor/dashboard/settings" className="inline-flex items-center gap-1 font-bold text-tm-red hover:underline">
            <Pencil aria-hidden size={12} /> Edit in Settings
          </Link>
        </p>

        {completion < 100 && (
          <p className="rounded-xl bg-tm-tint-gold p-2.5 text-[11px] font-semibold text-tm-gold-ink">
            Complete your profile for a fuller CV.{' '}
            <Link href="/tutor/dashboard/settings" className="font-bold underline">
              Settings
            </Link>
          </p>
        )}

        <div>
          {canDownload ? (
            <button
              type="button"
              onClick={download}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-60"
            >
              <Download aria-hidden size={14} />
              {busy ? 'Preparing…' : 'Download PDF'}
            </button>
          ) : (
            <div className="space-y-1.5">
              <UpgradeTrigger
                reason="cv_download"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
              >
                <Download aria-hidden size={14} />
                Verify to download
              </UpgradeTrigger>
              <p className="text-[11px] text-gray-500">The preview is yours free. The print-ready PDF comes with Verified.</p>
            </div>
          )}
        </div>
      </section>

      <CvPreview model={model} template={template} qrDataUrl={qrDataUrl} />
    </div>
  )
}
