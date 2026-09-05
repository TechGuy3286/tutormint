import 'server-only'

import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { BRAND, NEUTRAL } from '@/lib/brand'
import { GEIST_REGULAR_DATA_URI } from '@/lib/cv/font'
import type { CvModel, CvTemplate } from '@/lib/cv/model'

// The CV PDF — pure JS via @react-pdf/renderer, no headless browser, no
// external service. Same data (CvModel) and same section order as the on-screen
// preview (components/cv/CvPreview.tsx), so the two never diverge. Brand tokens
// come from lib/brand.ts as literals, the way next/og needs them — satori and
// react-pdf are the render targets that cannot read a CSS custom property.
//
// One font, embedded (lib/cv/font.ts): Geist Regular, carried in the PDF's own
// bytes so it prints identically at any shop. Emphasis is size + colour, not a
// second weight — a CV never depends on a face the printer might not have.

Font.register({ family: 'Geist', src: GEIST_REGULAR_DATA_URI })
// No mid-word hyphenation in a CV.
Font.registerHyphenationCallback((word) => [word])

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 10, color: NEUTRAL.slate700, lineHeight: 1.5 },
  // Classic header band
  bandHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: BRAND.navy, padding: 28 },
  mintRule: { height: 4, backgroundColor: BRAND.mint },
  bandName: { fontSize: 22, color: BRAND.white },
  bandHeadline: { fontSize: 11, color: BRAND.white, marginTop: 3 },
  // Minimal header
  minName: { fontSize: 22, color: BRAND.black },
  minHeadline: { fontSize: 11, color: NEUTRAL.slate700, marginTop: 3 },
  redRule: { height: 2, backgroundColor: BRAND.red, marginTop: 14, marginBottom: 14 },
  body: { padding: 34 },
  photo: { width: 84, height: 84, borderRadius: 12, objectFit: 'cover' },
  photoFallback: { width: 84, height: 84, borderRadius: 12, backgroundColor: BRAND.tintNavy, alignItems: 'center', justifyContent: 'center' },
  photoInitials: { fontSize: 26, color: BRAND.navy },
  section: { marginBottom: 14 },
  heading: { fontSize: 9, letterSpacing: 1, marginBottom: 5, textTransform: 'uppercase' },
  row: { flexDirection: 'row', marginBottom: 2 },
  bullet: { width: 10, color: NEUTRAL.slate400 },
  itemLevel: { color: BRAND.navy },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: NEUTRAL.slate200, paddingTop: 12, marginTop: 8 },
  footerLabel: { fontSize: 10, color: BRAND.navy },
  footerUrl: { fontSize: 9, color: NEUTRAL.slate700 },
  qr: { width: 64, height: 64 },
})

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
  const H = ({ children }: { children: string }) => (
    <Text style={[s.heading, { color: headingColor }]}>{children}</Text>
  )
  const Item = ({ children }: { children: React.ReactNode }) => (
    <View style={s.row}>
      <Text style={s.bullet}>•</Text>
      <Text style={{ flex: 1 }}>{children}</Text>
    </View>
  )
  return (
    <View>
      {model.about && (
        <View style={s.section}>
          <H>About</H>
          <Text>{model.about}</Text>
        </View>
      )}

      {model.subjects.length > 0 && (
        <View style={s.section}>
          <H>Subjects</H>
          {model.subjects.map((g) => (
            <Item key={g.level}>
              <Text style={s.itemLevel}>{g.level}</Text>
              {g.subjects.length > 0 ? ` — ${g.subjects.join(', ')}` : ''}
            </Item>
          ))}
        </View>
      )}

      {(model.experienceYears || model.location || model.teachingMode) && (
        <View style={s.section}>
          <H>Teaching</H>
          {model.experienceYears ? (
            <Item>
              {model.experienceYears} year{model.experienceYears === 1 ? '' : 's'} of experience
            </Item>
          ) : null}
          {model.location ? <Item>{model.location}</Item> : null}
          {model.teachingMode ? <Item>{model.teachingMode}</Item> : null}
        </View>
      )}

      {model.degrees.length > 0 && (
        <View style={s.section}>
          <H>Education</H>
          {model.degrees.map((d, i) => (
            <Item key={i}>{d}</Item>
          ))}
        </View>
      )}

      {model.languages.length > 0 && (
        <View style={s.section}>
          <H>Languages</H>
          <Text>{model.languages.join(', ')}</Text>
        </View>
      )}

      {model.contact && (
        <View style={s.section}>
          <H>Contact</H>
          {model.contact.phone ? <Item>{model.contact.phone}</Item> : null}
          {model.contact.whatsapp ? <Item>WhatsApp: {model.contact.whatsapp}</Item> : null}
          {model.contact.email ? <Item>{model.contact.email}</Item> : null}
        </View>
      )}
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
