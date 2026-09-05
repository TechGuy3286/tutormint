import { BookOpen, Briefcase, GraduationCap, Mail, MapPin, Monitor, Phone } from 'lucide-react'

import { cvContactRows, type CvModel, type CvTemplate } from '@/lib/cv/model'

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
  const H = ({ children }: { children: React.ReactNode }) => (
    <h3 className={`mb-1.5 text-[11px] font-black uppercase tracking-wider ${headingClass}`}>
      {children}
    </h3>
  )
  return (
    <div className="space-y-4 text-xs leading-relaxed text-slate-700">
      {model.about && (
        <section>
          <H>About</H>
          <p className="whitespace-pre-line">{model.about}</p>
        </section>
      )}

      {model.subjects.length > 0 && (
        <section>
          <H>Subjects</H>
          <ul className="space-y-1">
            {model.subjects.map((g) => (
              <li key={g.level} className="flex items-start gap-2">
                <BookOpen aria-hidden size={13} className="mt-0.5 shrink-0 text-gray-500" />
                <span>
                  <span className="font-bold text-tm-navy">{g.level}</span>
                  {g.subjects.length > 0 && <> — {g.subjects.join(', ')}</>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(model.experienceYears || model.location || model.teachingMode) && (
        <section>
          <H>Teaching</H>
          <ul className="space-y-1">
            {model.experienceYears && (
              <li className="flex items-center gap-2">
                <Briefcase aria-hidden size={13} className="shrink-0 text-gray-500" />
                {model.experienceYears} year{model.experienceYears === 1 ? '' : 's'} of experience
              </li>
            )}
            {model.location && (
              <li className="flex items-center gap-2">
                <MapPin aria-hidden size={13} className="shrink-0 text-gray-500" />
                {model.location}
              </li>
            )}
            {model.teachingMode && (
              <li className="flex items-center gap-2">
                <Monitor aria-hidden size={13} className="shrink-0 text-gray-500" />
                {model.teachingMode}
              </li>
            )}
          </ul>
        </section>
      )}

      {model.degrees.length > 0 && (
        <section>
          <H>Education</H>
          <ul className="space-y-1">
            {model.degrees.map((d, i) => (
              <li key={i} className="flex items-start gap-2">
                <GraduationCap aria-hidden size={13} className="mt-0.5 shrink-0 text-gray-500" />
                {d}
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.languages.length > 0 && (
        <section>
          <H>Languages</H>
          <p>{model.languages.join(', ')}</p>
        </section>
      )}

      {model.contact && (
        <section>
          <H>Contact</H>
          <ul className="space-y-1">
            {cvContactRows(model.contact).map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                {r.kind === 'email' ? (
                  <Mail aria-hidden size={13} className="shrink-0 text-gray-500" />
                ) : (
                  <Phone aria-hidden size={13} className="shrink-0 text-gray-500" />
                )}
                {r.label ? `${r.label}: ${r.value}` : r.value}
              </li>
            ))}
          </ul>
        </section>
      )}
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
