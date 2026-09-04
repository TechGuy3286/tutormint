import JobCard from '@/components/JobCard'
import { jobByPublicSlug } from '@/lib/jobFeed'

// A live tuition card embedded in a post by `{{job:public-slug}}`.
//
// Server component, fetched fresh so the post never shows a tuition that has
// since closed: jobByPublicSlug returns open jobs only, and a closed one
// renders nothing. Guest viewer — Apply is hidden and the card links through
// to the public tuition page.

export default async function BlogEmbedJob({ slug }: { slug: string }) {
  const job = await jobByPublicSlug(slug)
  if (!job) return null

  return (
    <div className="my-5">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        Open tuition
      </p>
      <JobCard job={job} signedIn={false} showApply={false} />
    </div>
  )
}
