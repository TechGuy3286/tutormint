import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { cachedSuggestion, readCnicFromDocument } from '@/lib/cnicReader'
import { isValidCnic } from '@/lib/cnic'

// The member's own CNIC number SUGGESTION (owner, 10 Oct 2026): read from the
// CNIC front they uploaded, for a member whose number is still empty. The CNIC
// number screen pre-fills its box with it and asks them to check it against
// their card; it is saved only when THEY press Next / Save (the existing
// /api/identity save-number). Nothing here saves a number, and nothing about
// any other account is ever returned.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('cnic_number').eq('id', user.id).maybeSingle()
  // A number already on file is the member's own entry; nothing to suggest.
  if (isValidCnic(profile?.cnic_number as string | null)) return NextResponse.json({ suggestion: null })

  const cached = await cachedSuggestion(user.id)
  if (!cached.documentId) return NextResponse.json({ suggestion: null })
  if (cached.read) return NextResponse.json({ suggestion: cached.number })

  // Not read yet (the background read after upload has not run or finished).
  const limit = await rateLimit('cnic_read_member', user.id)
  if (!limit.allowed) return NextResponse.json({ suggestion: null })
  const result = await readCnicFromDocument(cached.documentId)
  if (result.status === 'found') return NextResponse.json({ suggestion: result.number })
  if (result.status === 'pending') return NextResponse.json({ suggestion: null, pending: true })
  return NextResponse.json({ suggestion: null })
}
