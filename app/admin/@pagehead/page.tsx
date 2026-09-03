import PageHead from './[...slug]/page'

// The head for /admin itself. The catch-all beside this file matches one or
// more segments; Next refuses an OPTIONAL catch-all in a slot alongside
// app/admin/page.tsx ("same specificity as /admin"), so the zero-segment case
// is its own file and delegates rather than duplicating.
export const dynamic = 'force-dynamic'

export default async function AdminRootHead() {
  return PageHead({ params: Promise.resolve({ slug: [] }) })
}
