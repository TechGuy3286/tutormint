import MyLinkCardView from '@/components/admin/MyLinkCardView'
import { cvQrDataUri } from '@/lib/cv/assets'
import { loadMyLinkCard } from '@/lib/staffSignups'

// "My link" (owner, 23 Oct 2026) — on each staff member's admin home. Their
// personal link (https://www.tutormint.org/join?ref=<code>), a Copy button, a
// QR code, and their own counts. Shown only to staff who carry a code; the
// site Owner and the Project Managers have none, so they see nothing here.
// Counts leave out staff and test accounts (the People page rule).

export default async function MyLinkCard({ staffId }: { staffId: string }) {
  const card = await loadMyLinkCard(staffId)
  if (!card) return null
  return <MyLinkCardView url={card.link.url} counts={card.counts} qr={await cvQrDataUri(card.link.url)} />
}
