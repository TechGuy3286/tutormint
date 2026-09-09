import { Briefcase } from 'lucide-react'
import JobTypeChip from '@/components/JobTypeChip'

// A tutor's SET of Job Types as one clean chip (owner, 10 Sep 2026).
//
// A tutor offering all three should read cleanly, not as a cramped row of three
// separate chips. So: nothing → nothing; one type → the normal single chip
// (icon + full label, e.g. "Home Tuition"); two or three → ONE chip with the
// short labels joined ("Home · Online · School") behind a neutral briefcase.
// Presentational, no hooks. A JOB keeps a single Job Type and still uses
// JobTypeChip directly.

const SHORT: Record<string, string> = {
  home: 'Home',
  online: 'Online',
  school: 'School',
  // retired single values still render sensibly
  in_person: 'Home',
  both: 'Home',
  physical: 'Home',
}

export default function JobTypesChip({
  types,
  className = '',
}: {
  types: readonly string[] | null | undefined
  className?: string
}) {
  const list = (types ?? []).filter(Boolean)
  if (list.length === 0) return null
  if (list.length === 1) return <JobTypeChip mode={list[0]} className={className} />

  const label = list.map((t) => SHORT[t.toLowerCase()] ?? t).join(' · ')
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy ${className}`}
    >
      <Briefcase size={13} aria-hidden />
      {label}
    </span>
  )
}
