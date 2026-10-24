// lib/cv/pdfDocument.tsx
//
// The CV PDF document for all three templates (Modern, Classic, Minimal). The
// react-pdf module is PASSED IN rather than imported, so this file loads under
// the tsx test runner (react-pdf's hyphenate dependency has no CJS export, so
// a CommonJS file cannot import it — scripts/test-cv-pdf.mts imports react-pdf
// itself and hands it over) and the route (lib/cv/pdf.tsx) passes the real one.
//
// Every word comes from lib/cv/model.ts (cvModernLayout / cvSections) — the
// same functions the on-screen preview reads. Brand colours are literals from
// lib/brand.ts (react-pdf, like satori, cannot read a CSS custom property).
//
// Fonts: Plus Jakarta Sans 500/700/800 (the face the social posts use), with
// Noto Naskh Arabic as the per-character fallback so Urdu text prints as Urdu.
// All three are embedded as data URIs, so the PDF carries its fonts in its own
// bytes. One A4 page: the model is cut to fit (CV_BUDGET), checked by rendering
// the heaviest profile in every template (scripts/test-cv-pdf.mts). The page is
// NOT given wrap={false} — in react-pdf that shrinks the page to its content.

import type * as ReactPdf from '@react-pdf/renderer'

import { BRAND, NEUTRAL } from '@/lib/brand'
import { JAKARTA_500_B64, JAKARTA_700_B64, JAKARTA_800_B64 } from '@/lib/social/fonts'
import { NASKH_400_B64 } from '@/lib/cv/urduFont'
import { SILHOUETTE_SVG } from '@/lib/social/avatars'
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

export type RPdf = typeof ReactPdf

const FONTS = ['Jakarta', 'Naskh']

export const ACCENT_HEX: Record<CvAccent, string> = {
  navy: BRAND.navy,
  green: BRAND.greenDeep,
  charcoal: NEUTRAL.slate800,
}

let registered = false
export function registerCvFonts(R: RPdf): void {
  if (registered) return
  R.Font.register({
    family: 'Jakarta',
    fonts: [
      { src: `data:font/woff;base64,${JAKARTA_500_B64}`, fontWeight: 500 },
      { src: `data:font/woff;base64,${JAKARTA_700_B64}`, fontWeight: 700 },
      { src: `data:font/woff;base64,${JAKARTA_800_B64}`, fontWeight: 800 },
    ],
  })
  R.Font.register({ family: 'Naskh', fonts: [{ src: `data:font/woff;base64,${NASKH_400_B64}`, fontWeight: 400 }] })
  // No mid-word hyphenation in a CV.
  R.Font.registerHyphenationCallback((word) => [word])
  registered = true
}

// Small line icons (24×24 viewBox, stroked), the same set the preview draws.
const ICON_PATHS: Record<CvIcon, string[]> = {
  book: ['M4 4h11a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z', 'M17 6h3v14h-3'],
  briefcase: ['M2 9h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  pin: ['M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12z'],
  graduation: ['M22 10 12 5 2 10l10 5 10-5z', 'M6 12v5c0 1 3 3 6 3s6-2 6-3v-5'],
  phone: [
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 11a16 16 0 0 0 6 6l1.6-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z',
  ],
  whatsapp: ['M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z'],
  mail: ['M2 5h20v14H2z', 'M2 6l10 7 10-7'],
  wallet: ['M2 7h18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', 'M16 12h4'],
}

/** The grey silhouette's shapes, read from the same SVG text the site uses. */
type Shape = { tag: 'rect' | 'circle' | 'path'; a: Record<string, string> }
function silhouetteShapes(svg: string): Shape[] {
  const out: Shape[] = []
  for (const m of svg.matchAll(/<(rect|circle|path)\s([^>]*?)\/>/g)) {
    const a: Record<string, string> = {}
    for (const am of m[2].matchAll(/([a-z-]+)="([^"]*)"/g)) a[am[1]] = am[2]
    out.push({ tag: m[1] as Shape['tag'], a })
  }
  return out
}

export type CvDocArgs = {
  model: CvModel
  template: CvTemplate
  accent: CvAccent
  qrDataUri: string
  /** The photo as a JPEG/PNG data URI (only when model.photo is a photo). */
  photoDataUri: string | null
}

export function buildCvDocument(R: RPdf, args: CvDocArgs) {
  registerCvFonts(R)
  const { Document, Page, View, Text, Image, Svg, Path, Circle, Rect, Defs, ClipPath, G } = R
  const { model, template, accent: accentKey, qrDataUri, photoDataUri } = args
  const accent = ACCENT_HEX[accentKey]

  const Icon = ({ icon, size, color }: { icon: CvIcon; size: number; color: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {ICON_PATHS[icon].map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={2} fill="none" />
      ))}
      {icon === 'pin' ? <Circle cx={12} cy={10} r={2.5} stroke={color} strokeWidth={2} fill="none" /> : null}
    </Svg>
  )

  /** The round photo (or silhouette) in a green ring, with the ✓ for verified tutors. */
  const RingPhoto = ({ size }: { size: number }) => {
    if (!model.photo) return null
    const inner = size - 10
    const id = `clip-${size}`
    return (
      <View style={{ width: size, height: size, position: 'relative' }}>
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: BRAND.greenDeep,
            padding: 3,
          }}
        >
          <View style={{ width: size - 6, height: size - 6, borderRadius: (size - 6) / 2, backgroundColor: BRAND.white, padding: 2 }}>
            {model.photo.kind === 'photo' && photoDataUri ? (
              <Image src={photoDataUri} style={{ width: inner, height: inner, borderRadius: inner / 2, objectFit: 'cover' }} />
            ) : (
              <Svg width={inner} height={inner} viewBox="0 0 96 96">
                <Defs>
                  <ClipPath id={id}>
                    <Circle cx={48} cy={48} r={48} />
                  </ClipPath>
                </Defs>
                <G clipPath={`url(#${id})`}>
                  {silhouetteShapes(SILHOUETTE_SVG[model.photo.kind === 'silhouette' ? model.photo.avatar : 'neutral']).map((s, i) =>
                    s.tag === 'rect' ? (
                      <Rect key={i} x={0} y={0} width={96} height={96} fill={s.a.fill} />
                    ) : s.tag === 'circle' ? (
                      <Circle key={i} cx={Number(s.a.cx)} cy={Number(s.a.cy)} r={Number(s.a.r)} fill={s.a.fill} />
                    ) : (
                      <Path key={i} d={s.a.d} fill={s.a.fill} />
                    ),
                  )}
                </G>
              </Svg>
            )}
          </View>
        </View>
        {model.verified ? (
          <View style={{ position: 'absolute', right: size * 0.02, bottom: size * 0.04 }}>
            <Svg width={size * 0.26} height={size * 0.26} viewBox="0 0 24 24">
              <Circle cx={12} cy={12} r={11} fill={BRAND.greenDeep} stroke={BRAND.white} strokeWidth={2} />
              <Path d="M7 12.5l3.2 3.2L17 9" stroke={BRAND.white} strokeWidth={2.6} fill="none" />
            </Svg>
          </View>
        ) : null}
      </View>
    )
  }

  // Long names step down so they fit in two lines at most.
  const nameSize = (base: number) =>
    model.name.length > 60 ? base * 0.58 : model.name.length > 44 ? base * 0.68 : model.name.length > 26 ? base * 0.82 : base

  // ------------------------------------------------------------ Modern ----
  if (template === 'modern') {
    const { sidebar, main } = cvModernLayout(model)
    const sideText = { color: BRAND.white, fontSize: 8.5, lineHeight: 1.4 }
    const SideSection = ({ s }: { s: CvSection }) => (
      <View style={{ marginBottom: 14 }}>
        <Text style={{ color: BRAND.white, fontSize: 8, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>{s.heading}</Text>
        <View style={{ width: 26, height: 1.5, backgroundColor: BRAND.mint, marginTop: 3, marginBottom: 6 }} />
        {s.lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}>
            <View style={{ width: 13, marginTop: 1.5 }}>{l.icon ? <Icon icon={l.icon} size={9} color={BRAND.mint} /> : null}</View>
            <Text style={[sideText, { flex: 1 }]}>{l.text}</Text>
          </View>
        ))}
      </View>
    )
    const MainHeading = ({ text }: { text: string }) => (
      <View style={{ marginBottom: 6 }}>
        <Text style={{ color: accent, fontSize: 9.5, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>{text}</Text>
        <View style={{ width: 34, height: 1.5, backgroundColor: BRAND.greenDeep, marginTop: 3 }} />
      </View>
    )
    const body = { color: NEUTRAL.slate700, fontSize: 9, lineHeight: 1.5 }
    return (
      <Document title={`${model.name} — Tutor CV`} author="TutorMint">
        <Page size="A4" style={{ fontFamily: FONTS, fontWeight: 500, flexDirection: 'row' }}>
          <View style={{ width: 196, backgroundColor: accent, paddingTop: 30, paddingHorizontal: 20, paddingBottom: 24 }}>
            {model.photo ? (
              <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <RingPhoto size={118} />
              </View>
            ) : null}
            {sidebar.map((s) => (
              <SideSection key={s.key} s={s} />
            ))}
            <View style={{ marginTop: 'auto', alignItems: 'center' }}>
              <View style={{ backgroundColor: BRAND.white, padding: 5, borderRadius: 6 }}>
                <Image src={qrDataUri} style={{ width: 70, height: 70 }} />
              </View>
              <Text style={[sideText, { fontSize: 7.5, marginTop: 5 }]}>{QR_CAPTION}</Text>
            </View>
          </View>
          <View style={{ flex: 1, paddingTop: 34, paddingHorizontal: 30, paddingBottom: 26 }}>
            <Text style={{ color: BRAND.black, fontSize: nameSize(26), fontWeight: 800, lineHeight: 1.15 }}>{model.name}</Text>
            {model.headline ? (
              <Text style={{ color: NEUTRAL.slate700, fontSize: 10.5, fontWeight: 700, marginTop: 4, lineHeight: 1.3 }}>{model.headline}</Text>
            ) : null}
            <View style={{ height: 18 }} />
            {main.map((s) => (
              <View key={s.key} style={{ marginBottom: 14 }}>
                <MainHeading text={s.heading} />
                {s.key === 'subjects' ? (
                  <View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      {model.grid.map((c, i) => (
                        <View key={i} style={{ width: '50%', paddingRight: 8, marginBottom: 6 }}>
                          <Text style={{ color: accent, fontSize: 8.5, fontWeight: 700, lineHeight: 1.3 }}>{c.label}</Text>
                          {c.subjects.length > 0 ? <Text style={[body, { fontSize: 8.5, lineHeight: 1.35 }]}>{c.subjects.join(', ')}</Text> : null}
                        </View>
                      ))}
                    </View>
                    {model.subjectsMore ? <Text style={[body, { fontSize: 8.5, fontWeight: 700 }]}>{model.subjectsMore}</Text> : null}
                  </View>
                ) : (
                  s.lines.map((l, i) =>
                    l.icon === null ? (
                      <Text key={i} style={body}>
                        {l.text}
                      </Text>
                    ) : (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}>
                        <View style={{ width: 14, marginTop: 1.5 }}>
                          <Icon icon={l.icon} size={10} color={NEUTRAL.gray500} />
                        </View>
                        <Text style={[body, { flex: 1 }]}>{l.text}</Text>
                      </View>
                    ),
                  )
                )}
              </View>
            ))}
            <View style={{ marginTop: 'auto', borderTopWidth: 1, borderTopColor: NEUTRAL.slate200, paddingTop: 9 }}>
              <Text style={{ color: accent, fontSize: 9, fontWeight: 800 }}>{model.footer}</Text>
              <Text style={{ color: NEUTRAL.slate700, fontSize: 8 }}>{model.profileUrl}</Text>
            </View>
          </View>
        </Page>
      </Document>
    )
  }

  // ---------------------------------------------------- Classic / Minimal ----
  const headingColor = template === 'classic' ? accent : BRAND.red
  const Sections = () => (
    <View>
      {cvSections(model).map((section) => (
        <View key={section.key} style={{ marginBottom: 12 }}>
          <Text style={{ color: headingColor, fontSize: 9, fontWeight: 800, letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>
            {section.heading}
          </Text>
          {section.lines.map((l, i) =>
            l.icon === null ? (
              <Text key={i} style={{ marginBottom: 2 }}>
                {l.text}
              </Text>
            ) : (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}>
                <View style={{ width: 14, marginTop: 1 }}>
                  <Icon icon={l.icon} size={10} color={NEUTRAL.gray500} />
                </View>
                <Text style={{ flex: 1 }}>{l.text}</Text>
              </View>
            ),
          )}
        </View>
      ))}
    </View>
  )
  const Footer = () => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: NEUTRAL.slate200,
        paddingTop: 10,
        marginTop: 'auto',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, fontWeight: 800, color: BRAND.navy }}>{model.footer}</Text>
        <Text style={{ fontSize: 8.5 }}>{model.profileUrl}</Text>
      </View>
      <Image src={qrDataUri} style={{ width: 60, height: 60 }} />
    </View>
  )
  const page = { fontFamily: FONTS, fontWeight: 500, fontSize: 9.5, color: NEUTRAL.slate700, lineHeight: 1.45 }

  if (template === 'classic') {
    return (
      <Document title={`${model.name} — Tutor CV`} author="TutorMint">
        <Page size="A4" style={page}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: accent, padding: 26 }}>
            {model.photo ? (
              <View style={{ marginRight: 16 }}>
                <RingPhoto size={86} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: nameSize(22), fontWeight: 800, color: BRAND.white, lineHeight: 1.15 }}>{model.name}</Text>
              {model.headline ? <Text style={{ fontSize: 10.5, color: BRAND.white, marginTop: 4, lineHeight: 1.3 }}>{model.headline}</Text> : null}
            </View>
          </View>
          <View style={{ height: 4, backgroundColor: BRAND.mint }} />
          <View style={{ padding: 32, flexGrow: 1 }}>
            <Sections />
            <Footer />
          </View>
        </Page>
      </Document>
    )
  }

  return (
    <Document title={`${model.name} — Tutor CV`} author="TutorMint">
      <Page size="A4" style={page}>
        <View style={{ padding: 32, flexGrow: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {model.photo ? (
              <View style={{ marginRight: 16 }}>
                <RingPhoto size={80} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: nameSize(22), fontWeight: 800, color: BRAND.black, lineHeight: 1.15 }}>{model.name}</Text>
              {model.headline ? <Text style={{ fontSize: 10.5, color: NEUTRAL.slate700, marginTop: 4, lineHeight: 1.3 }}>{model.headline}</Text> : null}
            </View>
          </View>
          <View style={{ height: 2, backgroundColor: BRAND.red, marginTop: 14, marginBottom: 14 }} />
          <Sections />
          <Footer />
        </View>
      </Page>
    </Document>
  )
}
