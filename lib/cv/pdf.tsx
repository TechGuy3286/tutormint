import 'server-only'

import {
  Circle,
  Document,
  Font,
  Image,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'

import { BRAND, NEUTRAL } from '@/lib/brand'
import { GEIST_BOLD_DATA_URI, GEIST_REGULAR_DATA_URI } from '@/lib/cv/font'
import { cvSections, type CvIcon, type CvModel, type CvTemplate } from '@/lib/cv/model'

// The CV PDF — pure JS via @react-pdf/renderer, no headless browser, no
// external service. Every heading and line's text comes from cvSections(model)
// — the SAME function the on-screen preview (components/cv/CvPreview.tsx) reads
// — so the two renderers can never word anything differently. Only the layout
// and the icon glyphs are renderer-specific. Brand tokens are literals from
// lib/brand.ts (react-pdf, like satori, cannot read a CSS custom property).
//
// Two weights, both embedded (lib/cv/font.ts): Geist Regular and Geist Bold, so
// the name is genuinely bold — react-pdf has no faux-bold, a bold weight needs
// its own registered face.

Font.register({
  family: 'Geist',
  fonts: [
    { src: GEIST_REGULAR_DATA_URI, fontWeight: 'normal' },
    { src: GEIST_BOLD_DATA_URI, fontWeight: 'bold' },
  ],
})
// No mid-word hyphenation in a CV.
Font.registerHyphenationCallback((word) => [word])

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 10, color: NEUTRAL.slate700, lineHeight: 1.5 },
  // Classic header band
  bandHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: BRAND.navy, padding: 28 },
  mintRule: { height: 4, backgroundColor: BRAND.mint },
  // The name is bold and on its own line; the headline sits on the NEXT line
  // with its own line height and a top margin, so the two never overlap or
  // crowd whatever the font metrics do at these sizes.
  bandName: { fontSize: 22, fontWeight: 'bold', color: BRAND.white, lineHeight: 1.15 },
  bandHeadline: { fontSize: 11, color: BRAND.white, marginTop: 4, lineHeight: 1.35 },
  // Minimal header
  minName: { fontSize: 22, fontWeight: 'bold', color: BRAND.black, lineHeight: 1.15 },
  minHeadline: { fontSize: 11, color: NEUTRAL.slate700, marginTop: 4, lineHeight: 1.35 },
  redRule: { height: 2, backgroundColor: BRAND.red, marginTop: 14, marginBottom: 14 },
  body: { padding: 34 },
  photo: { width: 84, height: 84, borderRadius: 12, objectFit: 'cover' },
  photoFallback: { width: 84, height: 84, borderRadius: 12, backgroundColor: BRAND.tintNavy, alignItems: 'center', justifyContent: 'center' },
  photoInitials: { fontSize: 26, fontWeight: 'bold', color: BRAND.navy },
  section: { marginBottom: 14 },
  heading: { fontSize: 9, fontWeight: 'bold', letterSpacing: 1, marginBottom: 5, textTransform: 'uppercase' },
  paragraph: { marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 },
  iconWrap: { width: 14, marginTop: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: NEUTRAL.slate200, paddingTop: 12, marginTop: 8 },
  footerLabel: { fontSize: 10, fontWeight: 'bold', color: BRAND.navy },
  footerUrl: { fontSize: 9, color: NEUTRAL.slate700 },
  qr: { width: 64, height: 64 },
})

// The same icon set the preview draws (components/cv/CvPreview.tsx ICONS), as
// react-pdf Svg paths in the neutral the preview uses (text-gray-500), so a book
// beside a subject on screen is a book beside it in print — not a "•".
const ICON_PATHS: Record<CvIcon, string[]> = {
  book: ['M4 4h11a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z', 'M17 6h3v14h-3'],
  briefcase: ['M2 9h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  pin: ['M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12z'],
  graduation: ['M22 10 12 5 2 10l10 5 10-5z', 'M6 12v5c0 1 3 3 6 3s6-2 6-3v-5'],
  phone: [
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 11a16 16 0 0 0 6 6l1.6-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z',
  ],
  mail: ['M2 5h20v14H2z', 'M2 6l10 7 10-7'],
}

function PdfIcon({ icon, size, color }: { icon: CvIcon; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {ICON_PATHS[icon].map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={2} fill="none" />
      ))}
      {icon === 'pin' && <Circle cx={12} cy={10} r={2.5} stroke={color} strokeWidth={2} fill="none" />}
    </Svg>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'T'
}

function Photo({ model, photoDataUri }: { model: CvModel; photoDataUri: string | null }) {
  if (photoDataUri) return <Image src={photoDataUri} style={s.photo} />
  return (
    <View style={s.photoFallback}>
      <Text style={s.photoInitials}>{initials(model.name)}</Text>
    </View>
  )
}

function Sections({ model, headingColor }: { model: CvModel; headingColor: string }) {
  return (
    <View>
      {cvSections(model).map((section) => (
        <View key={section.key} style={s.section}>
          <Text style={[s.heading, { color: headingColor }]}>{section.heading}</Text>
          {section.lines.map((l, i) =>
            l.icon === null ? (
              <Text key={i} style={s.paragraph}>
                {l.text}
              </Text>
            ) : (
              <View key={i} style={s.row}>
                <View style={s.iconWrap}>
                  <PdfIcon icon={l.icon} size={11} color={NEUTRAL.gray500} />
                </View>
                <Text style={{ flex: 1 }}>{l.text}</Text>
              </View>
            ),
          )}
        </View>
      ))}
    </View>
  )
}

function Footer({ model, qrDataUri }: { model: CvModel; qrDataUri: string }) {
  return (
    <View style={s.footer}>
      <View style={{ flex: 1 }}>
        <Text style={s.footerLabel}>Verified tutor on TutorMint</Text>
        <Text style={s.footerUrl}>{model.profileUrl}</Text>
      </View>
      <Image src={qrDataUri} style={s.qr} />
    </View>
  )
}

function CvDocument({
  model,
  template,
  qrDataUri,
  photoDataUri,
}: {
  model: CvModel
  template: CvTemplate
  qrDataUri: string
  photoDataUri: string | null
}) {
  if (template === 'classic') {
    return (
      <Document title={`${model.name} — Tutor CV`} author="TutorMint">
        <Page size="A4" style={s.page}>
          <View style={s.bandHeader}>
            <Photo model={model} photoDataUri={photoDataUri} />
            <View style={{ flex: 1 }}>
              <Text style={s.bandName}>{model.name}</Text>
              {model.headline ? <Text style={s.bandHeadline}>{model.headline}</Text> : null}
            </View>
          </View>
          <View style={s.mintRule} />
          <View style={s.body}>
            <Sections model={model} headingColor={BRAND.navy} />
            <Footer model={model} qrDataUri={qrDataUri} />
          </View>
        </Page>
      </Document>
    )
  }

  return (
    <Document title={`${model.name} — Tutor CV`} author="TutorMint">
      <Page size="A4" style={s.page}>
        <View style={s.body}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Photo model={model} photoDataUri={photoDataUri} />
            <View style={{ flex: 1 }}>
              <Text style={s.minName}>{model.name}</Text>
              {model.headline ? <Text style={s.minHeadline}>{model.headline}</Text> : null}
            </View>
          </View>
          <View style={s.redRule} />
          <Sections model={model} headingColor={BRAND.red} />
          <Footer model={model} qrDataUri={qrDataUri} />
        </View>
      </Page>
    </Document>
  )
}

export async function renderCvPdf(args: {
  model: CvModel
  template: CvTemplate
  qrDataUri: string
  photoDataUri: string | null
}): Promise<Buffer> {
  return renderToBuffer(
    <CvDocument
      model={args.model}
      template={args.template}
      qrDataUri={args.qrDataUri}
      photoDataUri={args.photoDataUri}
    />,
  )
}
