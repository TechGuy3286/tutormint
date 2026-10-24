import { BookOpen, Briefcase, GraduationCap, Mail, MapPin, MessageCircle, Monitor, Phone, Wallet } from 'lucide-react'

import {
  QR_CAPTION,
  cvModernLayout,
  cvSections,
  type CvAccent,
  type CvIcon,
  type CvModel,
  type CvSection,
  type CvTemplate,
} from '@/lib/cv/model'

// The icon each line carries. The SAME set the PDF draws (lib/cv/pdfDocument.tsx).
const ICONS: Record<CvIcon, typeof BookOpen> = {
  book: BookOpen,
  briefcase: Briefcase,
  monitor: Monitor,
  pin: MapPin,
  graduation: GraduationCap,
  phone: Phone,
  whatsapp: MessageCircle,
  mail: Mail,
  wallet: Wallet,
}

// The accent colour as token classes (lib/cv/pdfDocument ACCENT_HEX is the
// same three colours for the PDF). White text on each clears AA — pinned in
// scripts/contrast-check.ts.
const ACCENT: Record<CvAccent, { bg: string; text: string }> = {
  navy: { bg: 'bg-tm-navy', text: 'text-tm-navy' },
  green: { bg: 'bg-tm-green-deep', text: 'text-tm-green-deep' },
  charcoal: { bg: 'bg-slate-800', text: 'text-slate-800' },
}

// The on-screen CV preview. HTML, tokens only, the SAME data (CvModel) the
// PDF renders from and the same words, so what a tutor sees is what prints.
//   modern  — accent sidebar (photo, contact, mode, areas, QR) + main column.
//   classic — accent header band, photo left, mint accent rule.
//   minimal — white, name over a thin red rule.

function RingPhoto({ model, size }: { model: CvModel; size: 'lg' | 'md' }) {
  if (!model.photo) return null
  const box = size === 'lg' ? 'h-28 w-28' : 'h-20 w-20'
  const src = model.photo.kind === 'photo' ? model.photo.url : `/avatars/${model.photo.avatar}.svg`
  return (
    <div className={`relative shrink-0 ${box}`}>
      <div className="h-full w-full rounded-full bg-tm-green-deep p-[3px]">
        <div className="h-full w-full rounded-full bg-white p-[2px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored avatar or the grey silhouette, shown as the PDF draws it */}
          <img src={src} alt="" className="h-full w-full rounded-full object-cover" />
        </div>
      </div>
      {model.verified && (
        <span
          aria-label="Verified"
          className="absolute bottom-0.5 right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-tm-green-deep text-white"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path d="M6 12.5l4 4L18 8.5" stroke="currentColor" strokeWidth={3} fill="none" />
          </svg>
        </span>
      )}
    </div>
  )
}

function Lines({ section, iconClass, textClass }: { section: CvSection; iconClass: string; textClass: string }) {
  return (
    <ul className="space-y-1">
      {section.lines.map((l, i) => {
        const Icon = l.icon ? ICONS[l.icon] : null
        return (
          <li key={i} className={`flex items-start gap-2 ${textClass}`}>
            <span className="mt-0.5 w-3.5 shrink-0">{Icon && <Icon aria-hidden size={13} className={iconClass} />}</span>
            <span className="min-w-0 break-words">{l.text}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Modern({ model, accent, qrDataUrl }: { model: CvModel; accent: CvAccent; qrDataUrl: string }) {
  const { sidebar, main } = cvModernLayout(model)
  const a = ACCENT[accent]
  return (
    <div className="flex flex-col sm:flex-row">
      <aside className={`${a.bg} flex flex-col gap-4 p-5 text-white sm:w-[34%]`}>
        {model.photo && (
          <div className="flex justify-center">
            <RingPhoto model={model} size="lg" />
          </div>
        )}
        {sidebar.map((s) => (
          <section key={s.key}>
            <h3 className="text-[11px] font-black uppercase tracking-wider text-white">{s.heading}</h3>
            <div className="mb-2 mt-1 h-0.5 w-7 bg-tm-mint" />
            <Lines section={s} iconClass="text-white" textClass="text-xs text-white" />
          </section>
        ))}
        <div className="mt-auto flex flex-col items-center gap-1.5 pt-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated QR data URI */}
          <img src={qrDataUrl} alt={`QR code linking to ${model.profileUrl}`} className="h-20 w-20 rounded-md bg-white p-1" />
          <p className="text-[11px] text-white">{QR_CAPTION}</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <h2 className="break-words text-2xl font-black leading-tight text-tm-black">{model.name}</h2>
        {model.headline && <p className="mt-1 text-xs font-bold text-slate-700">{model.headline}</p>}
        <div className="mt-5 space-y-4 text-xs leading-relaxed text-slate-700">
          {main.map((s) => (
            <section key={s.key}>
              <h3 className={`text-[11px] font-black uppercase tracking-wider ${a.text}`}>{s.heading}</h3>
              <div className="mb-2 mt-1 h-0.5 w-9 bg-tm-green-deep" />
              {s.key === 'subjects' ? (
                <>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    {model.grid.map((c, i) => (
                      <div key={i} className="min-w-0">
                        <p className={`font-bold ${a.text}`}>{c.label}</p>
                        {c.subjects.length > 0 && <p className="break-words">{c.subjects.join(', ')}</p>}
                      </div>
                    ))}
                  </div>
                  {model.subjectsMore && <p className="mt-1.5 font-bold">{model.subjectsMore}</p>}
                </>
              ) : s.lines.every((l) => l.icon === null) ? (
                s.lines.map((l, i) => (
                  <p key={i} className="whitespace-pre-line break-words">
                    {l.text}
                  </p>
                ))
              ) : (
                <Lines section={s} iconClass="text-gray-500" textClass="" />
              )}
            </section>
          ))}
        </div>
        <div className="mt-6 border-t border-gray-200 pt-3">
          <p className={`text-xs font-black ${a.text}`}>{model.footer}</p>
          <p className="truncate text-[11px] text-gray-500">{model.profileUrl}</p>
        </div>
      </div>
    </div>
  )
}

function Footer({ model, qrDataUrl }: { model: CvModel; qrDataUrl: string }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4 border-t border-gray-200 pt-4">
      <div className="min-w-0">
        <p className="text-xs font-black text-tm-navy">{model.footer}</p>
        <p className="truncate text-[11px] text-gray-500">{model.profileUrl}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- generated QR data URI */}
      <img src={qrDataUrl} alt={`QR code linking to ${model.profileUrl}`} className="h-16 w-16 shrink-0" />
    </div>
  )
}

function Sections({ model, headingClass }: { model: CvModel; headingClass: string }) {
  return (
    <div className="space-y-4 text-xs leading-relaxed text-slate-700">
      {cvSections(model).map((section) => (
        <section key={section.key}>
          <h3 className={`mb-1.5 text-[11px] font-black uppercase tracking-wider ${headingClass}`}>{section.heading}</h3>
          {section.lines.every((l) => l.icon === null) ? (
            section.lines.map((l, i) => (
              <p key={i} className="whitespace-pre-line break-words">
                {l.text}
              </p>
            ))
          ) : (
            <Lines section={section} iconClass="text-gray-500" textClass="" />
          )}
        </section>
      ))}
    </div>
  )
}

export default function CvPreview({
  model,
  template,
  accent = 'navy',
  qrDataUrl,
}: {
  model: CvModel
  template: CvTemplate
  accent?: CvAccent
  qrDataUrl: string
}) {
  const page = 'mx-auto w-full max-w-[680px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm'

  if (template === 'modern') {
    return (
      <div className={page}>
        <Modern model={model} accent={accent} qrDataUrl={qrDataUrl} />
      </div>
    )
  }

  if (template === 'classic') {
    return (
      <div className={page}>
        <div className={`flex items-center gap-4 p-6 ${ACCENT[accent].bg}`}>
          <RingPhoto model={model} size="md" />
          <div className="min-w-0">
            <h2 className="break-words text-xl font-black leading-tight text-white">{model.name}</h2>
            {model.headline && <p className="mt-1 text-xs font-semibold text-white">{model.headline}</p>}
          </div>
        </div>
        <div className="h-1 w-full bg-tm-mint" />
        <div className="p-6">
          <Sections model={model} headingClass={ACCENT[accent].text} />
          <Footer model={model} qrDataUrl={qrDataUrl} />
        </div>
      </div>
    )
  }

  // minimal
  return (
    <div className={page}>
      <div className="p-6">
        <div className="flex items-center gap-4">
          <RingPhoto model={model} size="md" />
          <div className="min-w-0">
            <h2 className="break-words text-xl font-black leading-tight text-tm-black">{model.name}</h2>
            {model.headline && <p className="mt-1 text-xs font-semibold text-slate-700">{model.headline}</p>}
          </div>
        </div>
        <div className="mt-4 h-0.5 w-full bg-tm-red" />
        <div className="mt-4">
          <Sections model={model} headingClass="text-tm-red" />
          <Footer model={model} qrDataUrl={qrDataUrl} />
        </div>
      </div>
    </div>
  )
}
