import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import JobForm from './JobForm'

// Post a tuition.
//
// The page refuses before the form is even rendered when the parent is not
// verified or has no quota left -- there is no point showing a form that will
// be rejected. /api/parent/jobs checks the same two things again, because a
// page that decides is a page that can be bypassed.
//
// The version this replaced was 750 lines of client component containing a
// hardcoded copy of the entire academic taxonomy, a fabricated "AI-matched
// tutors" panel built from invented people, and a hardcoded phone number.

export const dynamic = 'force-dynamic'

export default async function PostJobPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const [{ data: profile }, { data: children }, ent] = await Promise.all([
    supabase
      .from('profiles')
      .select('cnic_verified_at, address_verified_at, verification_state')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('children')
      .select('id, name, class_level')
      .eq('parent_id', userId)
      .order('created_at'),
    getEntitlements(userId),
  ])

  const verified = !!profile?.cnic_verified_at && !!profile?.address_verified_at

  if (!verified) {
    redirect('/parent/dashboard')
  }

  const outOfQuota = !ent.plan || ent.quotaLeft <= 0

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#334155] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="space-y-1">
          <Link href="/parent/dashboard" className="text-xs font-bold text-[#d60008] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Post a tuition</h1>
          <p className="text-xs text-gray-500">
            {ent.plan
              ? `${ent.quotaLeft} of ${ent.displayedQuota} posts left this month`
              : 'No active plan'}
          </p>
        </header>

        {outOfQuota ? (
          <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-[#92400E]">
              <AlertTriangle size={16} className="mt-px shrink-0" />
              You have used all {ent.quota} of this month&apos;s job posts. Your allowance resets at
              the start of next month, or Featured raises it.
            </p>
            <Link
              href="/parent/packages"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white"
            >
              See packages
            </Link>
          </section>
        ) : (
          <JobForm children={children ?? []} />
        )}
      </div>
    </main>
  )
}
