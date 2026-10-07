import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { levelSubjects, listLevels } from '@/lib/subjectsCore'
import SubjectsCoreClient from './SubjectsCoreClient'

// Admin → Settings → Subjects (owner, 7 Oct 2026). Owner and admin only,
// enforced on the server. Pick a level, tick its "Main subjects" — what the
// post-a-tuition "Main subjects" chip adds for that grade. Subjects themselves
// cannot be added, renamed or deleted here.

export const dynamic = 'force-dynamic'

export default async function SubjectsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.subjectsCore)
  const levels = await listLevels()
  const sp = await searchParams
  const level = levels.find((l) => l.slug === sp.level) ?? levels[0] ?? null
  const subjects = level ? await levelSubjects(level.slug) : []

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Subjects</h1>
        <p className="text-xs text-gray-500">
          Choose which subjects are a level&rsquo;s &ldquo;Main subjects&rdquo;. On Post a tuition, the &ldquo;Main
          subjects&rdquo; chip adds these to that grade. A level with none hides the chip. Subjects cannot be added,
          renamed or deleted here. Every change is recorded in the audit log.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="block text-[11px] font-bold text-gray-600">Level</span>
          <select
            name="level"
            defaultValue={level?.slug ?? ''}
            className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800"
          >
            {levels.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.category} › {l.name} ({l.coreCount} main)
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover">
          Show
        </button>
      </form>

      {level ? (
        <SubjectsCoreClient key={level.slug} levelSlug={level.slug} levelName={`${level.category} › ${level.name}`} subjects={subjects} />
      ) : (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">No levels found.</p>
      )}
    </div>
  )
}
