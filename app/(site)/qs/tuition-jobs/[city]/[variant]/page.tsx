import { renderVariantPage } from '../../../../tuition-jobs/[city]/[variant]/render'
import { generateMetadata } from '../../../../tuition-jobs/[city]/[variant]/page'

// The query twin (push 3, owner 1 Nov 2026): proxy.ts rewrites ?page= requests
// here so the clean address can be cached. Same page, same metadata.
export const dynamic = 'force-dynamic'
export { generateMetadata }

export default async function Page({ params, searchParams }: { params: Promise<{ city: string; variant: string }>; searchParams: Promise<{ page?: string }> }) {
  const [p, sp] = await Promise.all([params, searchParams])
  return renderVariantPage(p.city, p.variant, Math.max(1, Math.floor(Number(sp.page) || 1)))
}
