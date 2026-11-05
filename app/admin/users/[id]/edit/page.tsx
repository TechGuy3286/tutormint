import { ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import MemberTabs from '@/components/admin/MemberTabs'
import { requireAdminRole, SCREEN_ACCESS, roleMayWrite, roleSatisfies } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { maskCnicHeavy } from '@/lib/cnic'
import { formatDate } from '@/lib/datetime'
import { formatName } from '@/lib/formatName'
import { nameOwnerOnly } from '@/lib/nameEditCore'
import { editTabParts } from '@/lib/memberEditCore'
import { maskWhatsapp } from '@/lib/whatsappEditCore'
import WhatsAppEditForm from '@/components/admin/WhatsAppEditForm'
import SlugField from './SlugField'
import TutorFieldEditor from './TutorFieldEditor'
import TutorFieldHistory from './TutorFieldHistory'

// The member page's Edit tab (owner, 31 Oct 2026). It replaces the separate
// tutor record page (/admin/tutors/[id], now a permanent redirect here): the
// tutor's name, mobile, CNIC number and pictures, profile picture, selfie,
// subjects, city and areas, profile address, change history and retired
// addresses. Nothing here is on the Profile tab too: documents are DECIDED on
// the Profile tab's Documents box; this tab EDITS the fields.
//
// READ is the tutors screen; each edit tool shows only for a role that may
// write it, and every save re-checks the role in its route. The WhatsApp
// number section (owner, 4 Nov 2026) is also here for parents, and for
// Backend Support, who see only that section (SCREEN_ACCESS.memberWhatsappEdit).

export const dynamic = 'force-dynamic'

export default async function MemberEditPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.tutors, ...SCREEN_ACCESS.memberWhatsappEdit)
  const { id } = await params

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const [{ data: tutor }, { data: profile }, { data: history }] = await Promise.all([
    admin.from('tutor_profiles').select('id, slug, full_name, city, headline, bio, whatsapp_number').eq('id', id).maybeSingle(),
    admin.from('profiles').select('id, full_name, cnic_name, display_name, role, cnic_number, cnic_verified_at, whatsapp').eq('id', id).maybeSingle(),
    admin.from('slug_history').select('old_slug, created_at').eq('tutor_id', id).order('created_at', { ascending: false }).limit(20),
  ])
  const parts = editTabParts(actor.adminRole, (profile?.role as string | null) ?? null)
  if (!profile || !parts.show) notFound()
  if (parts.tutorFields && !tutor) notFound()
  const whatsappMasked = maskWhatsapp((profile.whatsapp as string | null) || ((tutor?.whatsapp_number as string | null) ?? null))
  const canWhatsapp = parts.whatsapp && roleMayWrite(actor.adminRole, SCREEN_ACCESS.memberWhatsappEdit)

  if (!parts.tutorFields || !tutor) {
    // A parent, or a role that may set only the WhatsApp number.
    const plainName = formatName(profile.full_name as string | null) || 'Member'
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-black text-tm-navy">{plainName}</h1>
        <MemberTabs memberId={id} current="edit" showProfile={roleSatisfies(actor.adminRole, SCREEN_ACCESS.usersView)} showEdit />
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-xs font-black text-tm-navy">WhatsApp number</h2>
          <p className="text-[11px] text-gray-500">Staff-only. Every change needs a reason and is kept in the history.</p>
          {canWhatsapp ? (
            <WhatsAppEditForm memberId={id} currentMasked={whatsappMasked} />
          ) : (
            <p className="text-xs text-slate-700">{whatsappMasked ?? 'None on file'}</p>
          )}
        </section>
      </div>
    )
  }

  const canSlugEdit = roleMayWrite(actor.adminRole, SCREEN_ACCESS.tutorSlug)
  const canFieldEdit = roleMayWrite(actor.adminRole, SCREEN_ACCESS.tutorEdit)
  const name = formatName(profile.full_name as string | null) || formatName(tutor.full_name as string | null) || 'Tutor'
  const slug = (tutor.slug as string | null) ?? null

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-black text-tm-navy">{name}</h1>
      <MemberTabs
        memberId={id}
        current="edit"
        showProfile={roleSatisfies(actor.adminRole, SCREEN_ACCESS.usersView)}
        showEdit
      />

      {canFieldEdit ? (
        <TutorFieldEditor
          tutorId={id}
          currentCity={(tutor.city as string | null) ?? null}
          cnicNumberMasked={maskCnicHeavy(profile.cnic_number as string | null)}
          currentName={formatName((profile.cnic_name as string | null) ?? null) || name}
          currentDisplayName={formatName((profile.display_name as string | null) ?? null)}
          nameOwnerOnly={nameOwnerOnly({ role: 'tutor', cnicVerifiedAt: profile.cnic_verified_at as string | null })}
          slug={slug}
          canSlugEdit={canSlugEdit}
          currentHeadline={(tutor.headline as string | null) ?? ''}
          currentBio={(tutor.bio as string | null) ?? ''}
          whatsappMasked={whatsappMasked}
          showWhatsapp={canWhatsapp}
        />
      ) : (
        // A role that may not edit the fields still sees the profile address.
        <SlugField tutorId={id} initialSlug={slug} canEdit={canSlugEdit} />
      )}

      <TutorFieldHistory tutorId={id} />

      {/* The redirects that exist because of past address changes. */}
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Retired addresses ({(history ?? []).length})</h2>
        {(history ?? []).length === 0 ? (
          <p className="text-xs text-gray-500">This tutor&apos;s address has never changed, so there is nothing redirecting here yet.</p>
        ) : (
          <ul className="space-y-1">
            {(history ?? []).map((h) => (
              <li key={h.old_slug as string} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-bold text-slate-700">/tutor/{h.old_slug as string}</span>
                <span aria-hidden className="text-gray-500">→</span>
                <span className="text-gray-500">current, since {formatDate(h.created_at as string)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        href="/admin/tutors/videos?filter=all"
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
      >
        <ClipboardList aria-hidden size={14} /> Video reviews
      </Link>
    </div>
  )
}
