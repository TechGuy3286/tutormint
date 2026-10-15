import CopyButton from '@/components/admin/CopyButton'

// A staff member's personal join link and code (owner, 15 Oct 2026), with copy
// buttons. Shown to the person themself on Tuitions → Tuition posting activity →
// Sign-ups by staff and on their Two-factor page, and to the Owner, the Project
// Managers and Admin on that person's Staff activity page.

export default function JoinLinkCard({
  url,
  code,
  title = 'Your join link',
}: {
  url: string
  code: string
  title?: string
}) {
  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-black text-tm-navy">{title}</h2>
      <p className="text-xs text-gray-600">
        Share this link, or ask people to type the code when they sign up. You get the credit for the tutors and
        parents who join through it for the next 30 days.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all rounded-lg bg-tm-bg px-2 py-1 text-xs font-bold text-slate-800">{url}</code>
        <CopyButton text={url} label="join link" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-600">Code:</span>
        <code className="rounded-lg bg-tm-bg px-2 py-1 text-xs font-black tracking-wider text-tm-navy">{code}</code>
        <CopyButton text={code} label="code" />
      </div>
    </section>
  )
}
