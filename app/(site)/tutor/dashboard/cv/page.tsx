import Breadcrumbs from '@/components/Breadcrumbs'
import CvClient from '@/components/cv/CvClient'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { buildCvRaw } from '@/lib/cv/build'
import { canDownloadCv } from '@/lib/cv/access'
import { cvQrDataUri } from '@/lib/cv/assets'

// /tutor/dashboard/cv — the CV builder. Every tutor sees a live preview of their
// own CV (built from their profile, no watermark); the PDF download is the
// Verified-gated action. The /tutor layout already gates role = tutor.

export const dynamic = 'force-dynamic'

export default async function TutorCvPage() {
  const session = await getSessionUser()
  const userId = session!.user.id

  const [raw, ent] = await Promise.all([buildCvRaw(userId), getEntitlements(userId)])
  const qrDataUrl = await cvQrDataUri(raw.profileUrl)
  const canDownload = canDownloadCv(ent)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Breadcrumbs
          items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Your CV' }]}
        />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Your CV</h1>
          <p className="text-xs text-gray-500">
            A print-ready CV, built from your profile. Preview it here; download the PDF to send to
            parents or print at any shop.
          </p>
        </header>

        <CvClient raw={raw} qrDataUrl={qrDataUrl} canDownload={canDownload} completion={raw.completion} />
      </div>
    </main>
  )
}
