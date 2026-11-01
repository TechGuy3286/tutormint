import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TutorViewer } from '@/lib/tutorViewerCore'

// The signed-in visitor's side of one tutor profile (push 3, owner 1 Nov 2026).
// The profile is cached for everyone; it asks here once when the visitor has a
// sign-in cookie. The phone and WhatsApp are returned ONLY when the viewer may
// see them (canViewContact, or the tutor themselves) — never in the page HTML.
// ?slug= instead of ?id= answers only "is this my own profile?" (for the
// preview of a profile that is not public yet). Never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

export async function GET(request: Request) {
  const url = new URL(request.url)
  const session = await getSessionUser().catch(() => null)
  const userId = session?.user.id ?? null
  const slug = url.searchParams.get('slug')
  if (slug !== null) {
    if (!userId) return NextResponse.json({ isSelf: false }, NO_STORE)
    const admin = createAdminClient()
    const { data } = admin ? await admin.from('tutor_profiles').select('slug').eq('id', userId).maybeSingle() : { data: null }
    return NextResponse.json({ isSelf: !!data && data.slug === slug }, NO_STORE)
  }
  const id = url.searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, ...NO_STORE })
  if (!userId) return NextResponse.json({ signedIn: false } satisfies TutorViewer, NO_STORE)

  const ent = await getEntitlements(userId)
  const isSelf = userId === id
  const contactUnlocked = !!ent.canViewContact || isSelf
  const isParent = ent.audience === 'parent'
  const supabase = await createClient()
  const admin = createAdminClient()
  const [savedRes, hiredRes, contact] = await Promise.all([
    supabase.from('shortlists').select('tutor_id').eq('tutor_id', id).maybeSingle(),
    isParent
      ? supabase.from('jobs').select('id').eq('parent_id', userId).eq('hired_tutor_id', id).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    contactUnlocked && admin
      ? Promise.all([
          admin.from('profiles').select('phone_number, whatsapp').eq('id', id).maybeSingle(),
          admin.from('tutor_profiles').select('phone_number, whatsapp_number').eq('id', id).maybeSingle(),
        ]).then(([{ data: p }, { data: tp }]) => ({
          phone: (p?.phone_number as string) || (tp?.phone_number as string) || null,
          whatsapp: (p?.whatsapp as string) || (tp?.whatsapp_number as string) || null,
        }))
      : Promise.resolve(null),
  ])
  return NextResponse.json(
    {
      signedIn: true,
      isSelf,
      audience: ent.audience ?? null,
      contactUnlocked,
      contact,
      saved: !!savedRes.data,
      isParent,
      hired: !!hiredRes.data,
    } satisfies TutorViewer,
    NO_STORE,
  )
}
