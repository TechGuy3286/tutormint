// Team inbox → Templates → Retired (n) (owner, 31 Oct 2026). Plain markup,
// no hooks, so it renders on its own too.

import type { AdminTemplate } from '@/lib/adminMessaging'

/** Retired templates (owner, 31 Oct 2026): no code path sends them. Kept and
 *  shown read only, collapsed — never deleted, never offered, never sent. */
export default function RetiredTemplates({ templates }: { templates: AdminTemplate[] }) {
  if (templates.length === 0) return null
  return (
    <details className="rounded-2xl border border-gray-200 bg-white p-4" data-retired-templates="">
      <summary className="cursor-pointer text-xs font-black text-tm-navy">Retired ({templates.length})</summary>
      <p className="mt-2 text-[11px] text-gray-600">No screen sends these any more. They are kept for the record.</p>
      <ul className="mt-2 space-y-2">
        {templates.map((t) => (
          <li key={t.key} className="rounded-xl border border-gray-100 bg-tm-bg p-3 text-xs">
            <p className="font-bold text-slate-700">{t.title}</p>
            {t.retiredReason && <p className="text-[11px] text-gray-600">{t.retiredReason}</p>}
            <p className="mt-1 whitespace-pre-line text-[11px] text-gray-600">{t.body}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
