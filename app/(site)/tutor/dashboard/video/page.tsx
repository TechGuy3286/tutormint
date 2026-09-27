import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Clapperboard } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import VideoUpload from '@/components/tutor/VideoUpload'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// The optional intro-video screen (PR76 §D.3). Video was removed from onboarding
// (§C.6) and from Settings (§D.2); it lives here, reached from the dashboard's
// mint "Intro video" tile, and is never a completion requirement. The tutor
// layout already gates /tutor/* to a tutor session, so this only re-reads the
// user id and the current video state to seed the existing VideoUpload flow.

export const dynamic = 'force-dynamic'

export default async function TutorIntroVideoPage() {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const userId = session.user.id

  const supabase = await createClient()
  const { data: tp } = await supabase
    .from('tutor_profiles')
    .select('video_attempts, video_status, video_youtube_id')
    .eq('id', userId)
    .maybeSingle()

  const attempts = (tp?.video_attempts as number | null) ?? 0
  const status = (tp?.video_status as string | null) ?? 'none'
  const hasVideo = !!(tp?.video_youtube_id as string | null)

  return (
    <main className="min-h-screen bg-tm-bg px-4 pt-3 pb-8">
      <div className="mx-auto w-full max-w-[480px] space-y-4">
        <Breadcrumbs
          items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Intro video' }]}
        />
        <Link
          href="/tutor/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-tm-navy hover:underline"
        >
          <ArrowLeft aria-hidden size={14} /> Back to Tutor dashboard
        </Link>

        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-black text-tm-navy">
            <Clapperboard aria-hidden size={20} /> Add a short intro video
          </h1>
          {/* No pressure — optional, and it can be added anytime. */}
          <p className="text-xs text-gray-500">
            Optional. A short hello helps parents choose you — you can add it anytime.
          </p>
          <p lang="ur" dir="rtl" className="text-xs text-gray-500">
            اختیاری۔ ایک مختصر تعارف والدین کو آپ کو منتخب کرنے میں مدد دیتا ہے — آپ اسے کبھی بھی شامل کر سکتے ہیں۔
          </p>
        </div>

        {hasVideo ? (
          <div className="flex items-center gap-2 rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3 text-xs font-bold text-tm-green-deep">
            <Clapperboard aria-hidden size={15} />
            <span>
              {status === 'approved'
                ? 'Your introduction video is uploaded and approved.'
                : 'Your introduction video is uploaded and awaiting review.'}
            </span>
          </div>
        ) : (
          <VideoUpload initialAttempts={attempts} initialStatus={status} />
        )}
      </div>
    </main>
  )
}
