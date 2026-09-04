import TutorCard, { type CardViewer } from '@/components/TutorCard'
import { tutorCardBySlug } from '@/lib/browseTutors'

// A live tutor card embedded in a post by `{{tutor:slug}}`.
//
// Server component: it fetches the current card data, so what a post says about
// a tutor cannot drift from what the directory shows. An unlisted or suspended
// tutor is simply not found (tutor_directory encodes the listing rule) and the
// embed renders nothing rather than a dead reference. Rendered as a guest — a
// blog reader is anonymous, and the buttons open the sign-in modal.

const GUEST: CardViewer = {
  signedIn: false,
  role: null,
  verifiedParent: false,
  canInitiateMessage: false,
}

export default async function BlogEmbedTutor({ slug }: { slug: string }) {
  const tutor = await tutorCardBySlug(slug)
  if (!tutor) return null

  return (
    <div className="not-prose my-5">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        Verified tutor
      </p>
      <TutorCard tutor={tutor} viewer={GUEST} initiallySaved={false} showMessage />
    </div>
  )
}
