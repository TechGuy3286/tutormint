import { FilterBarSkeleton, TutorCardSkeletons } from '@/components/Skeletons'

// Browse tutors, while the server renders a new filter set (#102/#103): the
// filter bar and three tutor-card skeletons in the real card's shape. Popular
// searches sit directly under the search bar on the real page, so the skeleton
// leaves that gap too.

export default function BrowseTutorsLoading() {
  return (
    <main className="min-h-screen bg-tm-bg px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <span aria-hidden className="block h-3 w-32 animate-pulse rounded-md bg-gray-200" />
        <span aria-hidden className="block h-7 w-56 animate-pulse rounded-md bg-gray-200" />
        <FilterBarSkeleton />
        <TutorCardSkeletons count={3} />
      </div>
    </main>
  )
}
