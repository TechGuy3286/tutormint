'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, AlertCircle, CircleDashed, Camera, Loader2 } from 'lucide-react'
import { compressImage } from '@/lib/imageCompress'
import { useToast } from '@/components/ui/Toast'
import type { DocumentStatuses, DocState } from '@/lib/tutorDocuments'

// The tutor's verification status for CNIC, profile picture and selfie (PR60),
// English with Urdu underneath, plus a selfie upload. This does NOT change who is
// listed — it only shows where each item stands and lets a tutor (re-)upload a
// selfie. The redesign of Settings comes in a later PR; this uses the current
// layout.

const URDU_FONT =
  "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Nafees Nastaleeq', 'Urdu Typesetting', 'Segoe UI', system-ui, sans-serif"

const STATUS: Record<
  DocState['status'],
  { en: string; ur: string; cls: string; Icon: typeof Clock }
> = {
  none: { en: 'Not uploaded yet', ur: 'ابھی اپلوڈ نہیں ہوا', cls: 'text-gray-500', Icon: CircleDashed },
  pending: { en: 'Waiting for approval', ur: 'منظوری کا انتظار ہے', cls: 'text-tm-navy', Icon: Clock },
  approved: { en: 'Approved', ur: 'منظور شدہ', cls: 'text-tm-green-deep', Icon: CheckCircle2 },
  rejected: { en: 'Rejected — please upload again', ur: 'مسترد — دوبارہ اپلوڈ کریں', cls: 'text-tm-red', Icon: AlertCircle },
}

function Urdu({ children }: { children: React.ReactNode }) {
  return (
    <span lang="ur" dir="rtl" className="block text-right" style={{ fontFamily: URDU_FONT }}>
      {children}
    </span>
  )
}

function StatusRow({ title, titleUr, state }: { title: string; titleUr: string; state: DocState }) {
  const s = STATUS[state.status]
  return (
    <div className="space-y-1 border-b border-gray-100 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-tm-navy">{title}</p>
          <Urdu>
            <span className="text-[11px] font-semibold text-tm-navy">{titleUr}</span>
          </Urdu>
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${s.cls}`}>
            <s.Icon size={13} aria-hidden />
            {s.en}
          </span>
          <Urdu>
            <span className={`text-[11px] font-semibold ${s.cls}`}>{s.ur}</span>
          </Urdu>
        </div>
      </div>
      {state.status === 'rejected' && state.reason && (
        <p className="rounded-lg bg-tm-tint-red p-2 text-[11px] font-semibold text-tm-red">{state.reason}</p>
      )}
    </div>
  )
}

export default function IdentityDocsStatus() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [statuses, setStatuses] = useState<DocumentStatuses | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tutor/document-status')
      if (res.ok) setStatuses((await res.json()) as DocumentStatuses)
    } catch {
      /* leave as null — the card just does not render */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const img = await compressImage(file, { maxEdge: 1200, quality: 0.8 })
      const fd = new FormData()
      fd.append('kind', 'selfie')
      fd.append('file', img)
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not upload your selfie.')
      toast.success('Selfie uploaded. Waiting for approval.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload your selfie.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!statuses) return null

  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-xs font-black text-tm-navy">Verification status</h2>
        <Urdu>
          <span className="text-[11px] font-semibold text-tm-navy">تصدیق کی حالت</span>
        </Urdu>
      </div>

      <div>
        <StatusRow title="CNIC (number and pictures)" titleUr="شناختی کارڈ (نمبر اور تصویریں)" state={statuses.cnic} />
        <StatusRow title="Profile picture" titleUr="پروفائل تصویر" state={statuses.profilePic} />
        <StatusRow title="Selfie" titleUr="سیلفی" state={statuses.selfie} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-tm-navy/30 px-4 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Camera size={14} aria-hidden />}
        {statuses.selfie.hasUpload ? 'Upload a new selfie' : 'Upload a selfie'}
      </button>
      <Urdu>
        <span className="text-[11px] font-semibold text-gray-500">
          اپنی سیلفی اپلوڈ کریں — چہرہ صاف نظر آنا چاہیے۔
        </span>
      </Urdu>
    </section>
  )
}
