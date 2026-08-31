import Link from 'next/link'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'

// Admin landing. Shows only what this role may open, so a verifier or finance
// admin is never sent to a screen that will bounce them.

export default async function AdminHome() {
  const actor = await getAdminActor()
  if (!actor) return null // the layout has already redirected

  const cards = [
    {
      href: '/admin/tutors',
      title: 'Tutor moderation',
      body: 'Review introduction videos, degrees and CNICs. Approve, hold or suspend.',
      allowed: SCREEN_ACCESS.tutors,
    },
    {
      href: '/admin/parents',
      title: 'Parent verification',
      body: 'Approve CNIC and address so a parent can post jobs.',
      allowed: SCREEN_ACCESS.parents,
    },
    {
      href: '/admin/plans',
      title: 'Plans',
      body: 'Grant or revoke a plan on any account. Pre-launch testing tool.',
      allowed: SCREEN_ACCESS.plans,
    },
  ].filter((c) => roleSatisfies(actor.adminRole, c.allowed))

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Admin</h1>
        <p className="text-xs text-gray-500">
          Signed in as {actor.email} · role <strong>{actor.adminRole}</strong>
        </p>
      </header>

      {cards.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center space-y-1">
          <p className="text-sm font-bold text-[#0F172A]">Nothing here yet for your role</p>
          <p className="text-xs text-gray-500">
            The reports, blocks and penalties screens land in T7.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="block bg-white border border-gray-200 rounded-2xl p-4 hover:border-[#0F172A] transition-colors space-y-1"
            >
              <p className="text-sm font-black text-[#0F172A]">{c.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{c.body}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
