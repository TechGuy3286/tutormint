import Link from 'next/link'

// The shell every "something went wrong" page shares.
//
// One component so that a 404, a crash, a suspended tutor's slug and an offline
// visitor all get the same shape: a short sentence saying what happened, and
// somewhere useful to go next. The thing that makes these pages good is not the
// apology — it is that nobody is left at a dead end, so the links are the part
// that is never optional.
//
// Deliberately plain markup with no client JavaScript: global-error.tsx renders
// when React itself has failed, and anything clever here would fail with it.

export type ErrorAction = { label: string; href: string; tone?: 'primary' | 'quiet' }

export default function ErrorShell({
  code,
  title,
  message,
  actions,
  detail,
}: {
  code?: string
  title: string
  message: string
  actions: ErrorAction[]
  detail?: React.ReactNode
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-tm-bg p-4 sm:p-6">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center justify-center text-xl font-black text-tm-navy"
        >
          Tutor<span className="text-tm-red">Mint</span>
        </Link>

        {code && (
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">{code}</p>
        )}

        <div className="space-y-2">
          <h1 className="text-lg font-black leading-tight text-tm-navy sm:text-xl">{title}</h1>
          <p className="text-sm leading-relaxed text-slate-700">{message}</p>
        </div>

        {detail}

        <div className="space-y-2 pt-1">
          {actions.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className={
                a.tone === 'quiet'
                  ? 'flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy'
                  : 'flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white shadow-md transition-colors hover:bg-tm-red-hover'
              }
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
