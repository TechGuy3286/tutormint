import { Briefcase } from 'lucide-react'
import JobTypeChip from '@/components/JobTypeChip'
import { jobType } from '@/lib/display'

// A tutor's SET of Job Types as one clean chip (owner, 10–11 Sep 2026).
//
// A tutor offering several titles should read as one chip, not a cramped row of
// separate ones. So: nothing → nothing; one title → the normal single chip
// (icon + label, e.g. "O Levels Teacher"); two or more → ONE chip with the full
// titles joined ("Home Tutor · Online Tutor · O Levels Teacher") behind a neutral
// briefcase. Presentational, no hooks. A JOB keeps a single Job Type and still
// uses JobTypeChip directly.

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

  const label = list.map((t) => jobType(t) ?? t).join(' · ')
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy ${className}`}
    >
      <Briefcase size={13} aria-hidden />
      {label}
    </span>
  )
}
