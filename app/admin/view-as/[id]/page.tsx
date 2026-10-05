import { redirect } from 'next/navigation'
import Link from 'next/link'
import { X } from 'lucide-react'

import { requireAdminRole } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCompletion } from '@/lib/completion'
import { getEntitlements } from '@/lib/entitlements'
import { loadDirectoryStatus } from '@/lib/directoryStatus'
import { viewSummary } from '@/lib/profileViews'
import TutorHeaderCard from '@/components/tutor/TutorHeaderCard'
import { formatName } from '@/lib/formatName'

// Owner-only "View as tutor" (PR106-H1 §5). A READ-ONLY render of what the tutor
// sees on their dashboard. Server-enforced read-only by construction: the owner's
// session is NEVER swapped, the tutor's data is loaded for DISPLAY through the
// service role, and this page carries no control that writes — so nothing here
// can change the tutor's (or anyone's) data. A fixed banner names who is being
// viewed; Exit returns to their admin page. Every open is audit-logged.

export const dynamic = 'force-dynamic'

export default async function ViewAsTutorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminRole() // no roles → owner only
  if (actor.adminRole !== 'owner') redirect('/admin')
  const { id } = await params

  const admin = createAdminClient()
  if (!admin) redirect('/admin')

  const { data: p } = await admin
    .from('profiles')
    .select('full_name, role, avatar_url')
    .eq('id', id)
    .maybeSingle()
  if (!p || p.role !== 'tutor') redirect(`/admin/tutors/${id}`)

  const { data: tp } = await admin.from('tutor_profiles').select('slug, city').eq('id', id).maybeSingle()
  const name = formatName(p.full_name as string | null) || 'Tutor'

  // Every use is recorded (PR106-H1 §5).
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'view_as_tutor',
    targetType: 'tutor_profile',
    targetId: id,
    detail: { name },
  })

  const [completion, ent, directory, views] = await Promise.all([
    computeCompletion(id),
    getEntitlements(id),
    loadDirectoryStatus(id),
    viewSummary(id, true, 20),
  ])
  const percent = completion?.percent ?? 0
  const publicHref = directory.listed && tp?.slug ? `/tutor/${tp.slug}` : null
  const findable = percent >= 100 && ent.verified && ent.badges.includes('Verified')

  const fact = (label: string, value: string) => (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-2 last:border-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-xs font-bold text-tm-navy">{value}</dd>
    </div>
  )

  return (
    <div className="min-h-screen bg-tm-bg">
      {/* Fixed read-only banner. */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-tm-gold/40 bg-tm-tint-gold px-4 py-2.5">
        <p className="text-xs font-black text-tm-gold-ink">
          Viewing as {name} — read-only
        </p>
        <Link
          href={`/admin/tutors/${id}`}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-tm-navy px-3 text-xs font-bold text-white hover:bg-tm-navy-hover"
        >
          <X aria-hidden size={14} /> Exit
        </Link>
      </div>

      <main className="mx-auto w-full max-w-[480px] space-y-3 px-4 pb-10 pt-3">
        <TutorHeaderCard
          name={name}
          avatarUrl={(p.avatar_url as string | null) ?? null}
          city={(tp?.city as string | null) ?? null}
          verified={ent.verified}
          planName={ent.planName}
          badges={ent.badges}
          verificationPending={!!ent.verificationPending}
          findable={findable}
          completion={percent}
          publicHref={publicHref}
        />

        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 text-xs font-black uppercase tracking-wide text-gray-500">What {name} sees</h2>
          <dl>
            {fact('Listed in search', directory.listed ? 'Yes' : 'Not yet')}
            {fact('Plan', ent.planName ?? 'None')}
            {fact('Spam Free Platform Fee', ent.verified ? 'Paid' : 'Not paid')}
            {fact('Profile complete', `${percent}%`)}
            {fact('Profile views this week', String(views.thisWeek))}
          </dl>
        </section>

        <p className="text-center text-[11px] text-gray-500">
          This is a read-only preview. Nothing here can be changed, and no message or payment can be sent.
        </p>
      </main>
    </div>
  )
}
