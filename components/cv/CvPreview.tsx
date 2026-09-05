import { BookOpen, Briefcase, GraduationCap, Mail, MapPin, Monitor, Phone } from 'lucide-react'

import { cvSections, type CvIcon, type CvModel, type CvTemplate } from '@/lib/cv/model'

// The icon each section line carries. The SAME set the PDF draws (lib/cv/pdf.tsx
// PdfIcon), so a book beside a subject on screen is a book beside it in print.
const ICONS: Record<CvIcon, typeof BookOpen> = {
  book: BookOpen,
  briefcase: Briefcase,
  monitor: Monitor,
  pin: MapPin,
  graduation: GraduationCap,
  phone: Phone,
  mail: Mail,
}

// The on-screen CV preview. HTML, tm-* tokens only, the SAME data (CvModel) the
// PDF renders from and the same section order, so what a tutor sees is what
// prints. Two templates:
//   classic — navy header band, photo left, mint accent rule.
//   minimal — white, name over a thin red rule, black text.
// Sections with no data are simply absent (the mapper omits them).

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'T'
}

function Photo({ model, ring }: { model: CvModel; ring: string }) {
  if (model.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a stored avatar URL,
    // shown as-is so the preview matches the PDF.
    return (
      <img
        src={model.photoUrl}
        alt=""
        className={`h-24 w-24 shrink-0 rounded-2xl object-cover ${ring}`}
      />
    )
  }
  return (
    <div
      className={`grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-tm-tint-navy text-2xl font-black text-tm-navy ${ring}`}
    >
      {initials(model.name)}
    </div>
  )
}

function Footer({ model, qrDataUrl }: { model: CvModel; qrDataUrl: string }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4 border-t border-gray-200 pt-4">
      <div className="min-w-0">
        <p className="text-xs font-black text-tm-navy">
          Verified tutor on&nbsp;
          <span className="text-tm-navy">Tutor</span>
          <span className="text-tm-red">Mint</span>
        </p>
        <p className="truncate text-[11px] text-gray-500">{model.profileUrl}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- generated QR data URI */}
      <img src={qrDataUrl} alt={`QR code linking to ${model.profileUrl}`} className="h-16 w-16 shrink-0" />
    </div>
  )
}

function Sections({ model, headingClass }: { model: CvModel; headingClass: string }) {
  // Every heading and every line's text comes from cvSections(model) — the same
  // function the PDF reads — so the two renderers cannot word anything
  // differently. Only the styling and the icon glyphs are renderer-specific.
  return (
    <div className="space-y-4 text-xs leading-relaxed text-slate-700">
      {cvSections(model).map((section) => (
        <section key={section.key}>
          <h3 className={`mb-1.5 text-[11px] font-black uppercase tracking-wider ${headingClass}`}>
            {section.heading}
          </h3>
          {section.lines.every((l) => l.icon === null) ? (
            // A paragraph section (About, Languages): no bullets.
            section.lines.map((l, i) => (
              <p key={i} className="whitespace-pre-line">
                {l.text}
              </p>
            ))
          ) : (
            <ul className="space-y-1">
              {section.lines.map((l, i) => {
                const Icon = l.icon ? ICONS[l.icon] : null
                return (
                  <li key={i} className="flex items-start gap-2">
                    {Icon && <Icon aria-hidden size={13} className="mt-0.5 shrink-0 text-gray-500" />}
                    <span>{l.text}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

export default function CvPreview({
  model,
  template,
  qrDataUrl,
}: {
  model: CvModel
  template: CvTemplate
  qrDataUrl: string
}) {
  // A4 portrait proportion (1 : 1.414), a white page with print margins.
  const page =
    'mx-auto w-full max-w-[640px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm'

  if (template === 'classic') {
    return (
      <div className={page}>
        <div className="flex items-center gap-4 bg-tm-navy p-6">
          <Photo model={model} ring="ring-2 ring-tm-mint" />
          <div className="min-w-0">
            <h2 className="text-xl font-black leading-tight text-white">{model.name}</h2>
            {model.headline && <p className="mt-1 text-xs font-semibold text-white">{model.headline}</p>}
          </div>
        </div>
        <div className="h-1 w-full bg-tm-mint" />
        <div className="p-6">
          <Sections model={model} headingClass="text-tm-navy" />
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
          <Photo model={model} ring="ring-1 ring-gray-200" />
          <div className="min-w-0">
            <h2 className="text-xl font-black leading-tight text-tm-black">{model.name}</h2>
            {model.headline && <p className="mt-1 text-xs font-semibold text-gray-500">{model.headline}</p>}
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
