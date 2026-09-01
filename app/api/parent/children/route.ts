import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, uuid } from '@/lib/validate'

// A parent's children.
//
// Names of children are the most sensitive ordinary data on the platform, so
// they are never part of a public job card and never leave the parent's own
// dashboard except to a tutor the parent is already talking to. RLS scopes
// every row to parent_id = auth.uid(); this route scopes the write the same
// way rather than trusting a parent_id from the body.

const ChildBody = z.object({
  action: z.enum(['save', 'remove']).default('save'),
  id: uuid.optional(),
  name: z.string().max(120, 'That name is too long.').optional(),
  classLevel: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const parsed = await parseBody(request, ChildBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (body.action === 'remove') {
    if (!body.id) return NextResponse.json({ error: 'Missing child.' }, { status: 400 })
    const { error } = await supabase
      .from('children')
      .delete()
      .eq('id', body.id)
      .eq('parent_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  const name = (body.name ?? '').trim()
  if (name.length < 2) {
    return NextResponse.json({ error: "Enter the child's name." }, { status: 400 })
  }

  const row = {
    parent_id: user.id,
    name,
    class_level: (body.classLevel ?? '').trim() || null,
    notes: (body.notes ?? '').trim() || null,
  }

  const query = body.id
    ? supabase.from('children').update(row).eq('id', body.id).eq('parent_id', user.id).select('id').single()
    : supabase.from('children').insert(row).select('id').single()

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logActivity({
    userId: user.id,
    event: 'profile_updated',
    targetType: 'child',
    targetId: data.id as string,
    meta: { action: body.id ? 'child_updated' : 'child_added' },
  })

  return NextResponse.json({ success: true, id: data.id })
}
