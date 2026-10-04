// A plain "you tried to open a screen your role cannot see" strip, shown on the
// role's home page when it was redirected there with ?denied=1 (PR106-H2). The
// message is the whole point — a silent bounce leaves staff thinking a link is
// broken. Brand tokens only.
export default function AccessDeniedNotice() {
  return (
    <p
      role="status"
      className="rounded-xl border border-tm-gold/40 bg-tm-tint-gold px-4 py-3 text-xs font-bold text-tm-gold-ink"
    >
      You don&rsquo;t have access to this page. Here&rsquo;s what your role can open.
    </p>
  )
}
