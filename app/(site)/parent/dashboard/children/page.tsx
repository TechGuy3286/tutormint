import Breadcrumbs from '@/components/Breadcrumbs'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

import ChildrenManager, { type Child } from '../ChildrenManager'

// The children editor, moved off the dashboard.
//
// It is a form with a list and a delete control -- something a parent visits
// when they are changing it, not something they need on every visit. Inline it
// cost the dashboard a card, two rows and an add form permanently.

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'My children | TutorMint',
  robots: { index: false, follow: false },
}

export default async function ParentChildrenPage() {
  const session = await getSessionUser()
  const supabase = await createClient()

  const { data: children } = await supabase
    .from('children')
    .select('id, name, class_level, notes')
    .eq('parent_id', session!.user.id)
    .order('created_at')

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Parent dashboard', href: '/parent/dashboard' },
            { label: 'My children' },
          ]}
        />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">My children</h1>
          <p className="text-xs text-gray-500">
            A tuition post can name one of them. Their names are never shown publicly.
          </p>
        </header>

        <ChildrenManager children={(children ?? []) as Child[]} />
      </div>
    </main>
  )
}
