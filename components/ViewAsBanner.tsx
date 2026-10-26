import { VIEW_AS_EXIT_PATH } from '@/lib/viewAsCore'

// The fixed "View as" banner (owner, 26 Oct 2026): shown on every page while the
// Owner views a member's account. Exit ends it (the exit route puts the Owner's
// own session back).

export default function ViewAsBanner({ name }: { name: string }) {
  return (
    <>
      <div
        role="status"
        data-view-as-banner=""
        className="fixed inset-x-0 top-0 z-[90] flex min-h-[40px] items-center justify-center gap-2 bg-tm-red px-4 py-2 text-center text-xs font-bold text-white"
      >
        <span>Viewing as {name} — read only</span>
        <span aria-hidden>·</span>
        <a href={VIEW_AS_EXIT_PATH} className="rounded-md bg-white px-2 py-0.5 text-tm-red hover:bg-tm-tint-red">
          Exit
        </a>
      </div>
      <div aria-hidden className="h-10" />
    </>
  )
}
