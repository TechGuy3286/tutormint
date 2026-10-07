import Link from 'next/link'

import { displayGroups, type GradeGroup } from '@/lib/gradeSubjects'

// Subjects grouped by grade (owner, 7 Oct 2026): "Grade 1: English, Urdu ·
// Grade 2: Maths", or once — "Grades 1–3: English, Urdu, Maths" — when every
// grade has the same subjects. Each chip links where the flat chips did (the
// tutors who teach that subject). `max` truncates each group with "+N more"
// on narrow cards; the tuition page shows every subject.

export default function SubjectsByGrade({
  groups,
  links,
  city,
  max,
  chipClass,
}: {
  groups: GradeGroup[]
  links?: { label: string; masterId: number; href?: string | null }[] | null
  city: string | null
  max?: number
  chipClass: string
}) {
  const shown = displayGroups(groups)
  if (shown.length === 0) return null
  return (
    <div className="space-y-1.5">
      {shown.map((g) => {
        const visible = max ? g.subjects.slice(0, max) : g.subjects
        const more = g.subjects.length - visible.length
        return (
          <div key={g.label} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-black text-tm-navy">{g.label}:</span>
            {visible.map((s) => {
              const link = links?.find((l) => l.label === s)
              return link ? (
                <Link
                  key={s}
                  prefetch={false}
                  href={link.href ?? `/browse/tutors?subject=${link.masterId}${city ? `&city=${encodeURIComponent(city)}` : ''}`}
                  className={`${chipClass} relative z-10 hover:ring-tm-navy`}
                >
                  {s}
                </Link>
              ) : (
                <span key={s} className={chipClass}>
                  {s}
                </span>
              )
            })}
            {more > 0 && <span className="text-[11px] font-bold text-gray-500">+{more} more</span>}
          </div>
        )
      })}
    </div>
  )
}
