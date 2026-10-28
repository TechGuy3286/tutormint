// "Fee missing" (owner, 28 Oct 2026): an OPEN tuition with no fee per month.
// Shown on admin tuition cards and the tuition's admin page, so the poster adds
// the fee — JobPosting baseSalary is emitted only when a fee exists. A fee is
// never invented for an older tuition.

export default function FeeMissingChip() {
  return (
    <span className="rounded-full bg-tm-tint-red px-2 py-0.5 text-[10px] font-black text-tm-red" title="Add the fee per month on this tuition">
      Fee missing
    </span>
  )
}
