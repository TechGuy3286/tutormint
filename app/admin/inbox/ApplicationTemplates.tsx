'use client'

// Team inbox → Templates → Applications (owner, 23 Oct 2026, Applications v3.1).
//
// The 8 messages Admin → Tuitions → Applications pre-fills, plus the forward
// panel's message, each with who it goes to, the placeholders it may use, a
// live preview filled with sample data, and "Reset to default". Unknown
// placeholders block a save (the server checks again); a price or superlative
// is a warning. The support number every message ends with is a setting —
// shown here, changed by the Owner only.

import { POST_TUITION_PUBLIC_PATH } from '@/lib/postTuitionPage'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import type { AdminTemplate } from '@/lib/adminMessaging'
import { APPLICATIONS_GROUP, CONSENT_GROUP, FOLLOW_UPS_GROUP, PARENTS_GROUP, STATUS_GROUP, warningsFor, type GroupTemplateInfo } from '@/lib/templateRules'
import { fillConsentAsk } from '@/lib/tuitionConsentCore'
import { fillParentFollowUp, PARENT_PLACEHOLDER_HELP } from '@/lib/parentFollowUpCore'
import { fillStatusMessage, STATUS_PLACEHOLDER_HELP, statusSaveProblem } from '@/lib/social/statusImageCore'
import { FEE_REPLY_PAY_PATH, fillFollowUp, FU_FEE_REPLY_KEY, FU_PLACEHOLDER_HELP } from '@/lib/followUpTemplatesCore'
import { siteLink } from '@/lib/waLinkCore'
import {
  PLACEHOLDER_HELP,
  SAMPLE_VALUES,
  fillTemplate,
  unknownPlaceholderError,
  unknownPlaceholders,
} from '@/lib/applicationTemplatesCore'
import { buildForwardMessage, APPLICANTS_FORWARD_TEMPLATE_KEY } from '@/lib/applicantForwardCore'

const GROUP_TITLE = { applications: 'Applications', follow_ups: 'Follow-ups', parents: 'Parents', status: 'Status image', consent: 'Consent' } as const
const GROUP_INTRO = {
  applications: 'The messages Tuitions → Applications pre-fills. ',
  follow_ups: 'The messages Follow-ups → Tutors pre-fills, one per reason a tutor is stuck. Some were already in use and are shared here as they are. ',
  parents: 'The messages Follow-ups → Parents pre-fills, one per situation. Short, plain English, no prices. ',
  consent: 'The WhatsApp message “Ask parent” sends to a parent whose consent to be listed is not recorded. Plain English, no prices. ',
  status: 'The WhatsApp message sent with the "I’m a Verified Tutor" status image. It must never contain a link. ',
} as const

const RECIPIENT_CHIP = {
  parent: 'bg-tm-tint-navy text-tm-navy',
  tutor: 'bg-tm-tint-green text-tm-green-deep',
} as const

function preview(info: GroupTemplateInfo, body: string, support: string): string {
  if (CONSENT_GROUP.some((t) => t.key === info.key)) {
    return fillConsentAsk(body, { parentName: SAMPLE_VALUES.parent_name, tuitionTitle: SAMPLE_VALUES.tuition_title, tmNumber: SAMPLE_VALUES.tm_number })
  }
  if (STATUS_GROUP.some((t) => t.key === info.key)) return fillStatusMessage(body, SAMPLE_VALUES.tutor_first_name)
  if (PARENTS_GROUP.some((t) => t.key === info.key)) {
    return fillParentFollowUp(body, {
      firstName: SAMPLE_VALUES.parent_name,
      tuitionTitle: SAMPLE_VALUES.tuition_title,
      tuitionLink: 'https://www.tutormint.org/tuitions/lahore/sample-tuition-1a2b3c',
      postLink: siteLink(POST_TUITION_PUBLIC_PATH),
      tutorName: SAMPLE_VALUES.tutor_name,
      reviewLink: siteLink('/review'),
      supportWhatsapp: support,
    })
  }
  if (FOLLOW_UPS_GROUP.some((t) => t.key === info.key)) {
    return fillFollowUp(
      body,
      {
        firstName: SAMPLE_VALUES.tutor_first_name,
        completion: 60,
        nextStep: 'add your profile photo',
        continueLink: SAMPLE_VALUES.dashboard_link,
        payLink: info.key === FU_FEE_REPLY_KEY ? siteLink(FEE_REPLY_PAY_PATH) : 'https://www.tutormint.org/pay/choose?plan=verified',
        document: 'selfie',
        reason: 'Reason: face not clear.',
        supportWhatsapp: support,
      },
      info.key === 'payment_not_finished' || info.key === FU_FEE_REPLY_KEY ? 'pay' : 'continue',
    )
  }
  if (info.key === APPLICANTS_FORWARD_TEMPLATE_KEY) {
    return buildForwardMessage({
      template: body,
      parentName: SAMPLE_VALUES.parent_name,
      tuitionTitle: SAMPLE_VALUES.tuition_title,
      area: SAMPLE_VALUES.area,
      tutors: [{ name: SAMPLE_VALUES.tutor_name, profileUrl: SAMPLE_VALUES.profile_link }],
    })
  }
  return fillTemplate(body, { ...SAMPLE_VALUES, support_whatsapp: support })
}

export default function ApplicationTemplates({
  templates,
  supportDisplay,
  isOwner,
  defaultOpen = false,
  group = 'applications',
}: {
  templates: AdminTemplate[]
  supportDisplay: string
  isOwner: boolean
  defaultOpen?: boolean
  /** Follow-ups (owner, 23 Oct 2026): the messages Follow-ups → Tutors pre-fills.
   *  Parents and the status image message (owner, 26 Oct 2026). */
  group?: 'applications' | 'follow_ups' | 'parents' | 'status' | 'consent'
}) {
  const byKey = useMemo(() => new Map(templates.map((t) => [t.key, t])), [templates])
  const list = group === 'follow_ups' ? FOLLOW_UPS_GROUP : group === 'parents' ? PARENTS_GROUP : group === 'status' ? STATUS_GROUP : group === 'consent' ? CONSENT_GROUP : APPLICATIONS_GROUP
  const items = list.map((info) => ({ info, t: byKey.get(info.key) })).filter(
    (x): x is { info: GroupTemplateInfo; t: AdminTemplate } => !!x.t,
  )
  return (
    <details open={defaultOpen} className="rounded-xl border border-tm-navy/30 bg-tm-bg p-3" id={`${group.replace('_', '-')}-templates`}>
      <summary className="cursor-pointer text-sm font-black text-tm-navy">
        {GROUP_TITLE[group]} ({items.length})
      </summary>
      <div className="space-y-3 pt-2">
        <p className="text-[11px] text-gray-600">
          {GROUP_INTRO[group]}
          Edit the wording; the placeholders in {'{braces}'} fill in when staff tap the WhatsApp button.
        </p>
        <SupportNumber display={supportDisplay} isOwner={isOwner} />
        {items.length === 0 && <p className="text-xs text-gray-500">These templates are not set up yet.</p>}
        {items.map(({ info, t }) => (
          <TemplateCard key={info.key} info={info} template={t} support={supportDisplay} />
        ))}
      </div>
    </details>
  )
}

function SupportNumber({ display, isOwner }: { display: string; isOwner: boolean }) {
  const toast = useToast()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; display?: string }>('/api/admin/settings/support-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: value }),
    })
    setBusy(false)
    if (!ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success(`Support WhatsApp number saved: ${data.display ?? ''}. Every Applications message uses it now.`)
    setEditing(false)
    setValue('')
    router.refresh()
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
      <span className="font-bold text-slate-700">Support WhatsApp number:</span>
      <span className="font-mono text-tm-navy">{display}</span>
      <span className="text-gray-500">fills {'{support_whatsapp}'} · setting “support.whatsapp”</span>
      {isOwner && !editing && (
        <button type="button" onClick={() => setEditing(true)} className="ms-auto min-h-[36px] rounded-lg border border-gray-200 px-3 font-bold text-tm-navy">
          Change
        </button>
      )}
      {isOwner && editing && (
        <span className="ms-auto flex items-center gap-1">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="tel"
            placeholder="0321 5872222"
            aria-label="New support WhatsApp number"
            className="min-h-[36px] w-36 rounded-lg border border-gray-200 px-2"
          />
          <button type="button" disabled={busy} onClick={() => void save()} className="min-h-[36px] rounded-lg bg-tm-black px-3 font-bold text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="min-h-[36px] rounded-lg border border-gray-200 px-3 font-bold text-slate-700">
            Cancel
          </button>
        </span>
      )}
      {!isOwner && <span className="ms-auto text-[11px] text-gray-500">Only the Owner can change it.</span>}
    </div>
  )
}

function TemplateCard({ info, template, support }: { info: GroupTemplateInfo; template: AdminTemplate; support: string }) {
  const toast = useToast()
  const router = useRouter()
  const [title, setTitle] = useState(template.title)
  const [body, setBody] = useState(template.body)
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null)
  const unknown = unknownPlaceholders(body, info.placeholders)
  const linkProblem = info.noLinks ? statusSaveProblem(body) : null
  const warnings = warningsFor(info.key, body)
  // The approved wording when the Owner approved one, else the built-in default.
  const isDefault = body === (template.resetBody ?? info.defaultBody)

  async function put(payload: object, kind: 'save' | 'reset') {
    setBusy(kind)
    const { ok, data } = await adminFetch<{ error?: string; body?: string; warnings?: string[] }>('/api/admin/inbox', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(null)
    if (!ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    if (typeof data.body === 'string') setBody(data.body)
    toast.success(kind === 'reset' ? 'Back to the default wording.' : 'Template saved.')
    for (const w of data.warnings ?? []) toast.error(`Saved, but check: ${w}`)
    router.refresh()
  }

  return (
    <details className="rounded-xl border border-gray-200 bg-white p-3" data-template={info.key}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs font-black text-tm-navy">
        {template.title}
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${RECIPIENT_CHIP[info.recipient]}`}>
          To {info.recipient === 'parent' ? 'Parent' : 'Tutor'}
        </span>
        {!isDefault && <span className="rounded bg-tm-tint-gold px-1.5 py-0.5 text-[10px] font-bold text-tm-gold-ink">Edited</span>}
      </summary>
      <div className="grid gap-3 pt-2 lg:grid-cols-[1fr_220px]">
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-h-[40px] w-full rounded-lg border border-gray-200 px-3 text-xs"
            aria-label="Title"
          />
          <textarea
            rows={7}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs"
            aria-label="Message"
          />
          {unknown.length > 0 && <p className="text-xs font-bold text-tm-red">{unknownPlaceholderError(unknown)}</p>}
          {linkProblem && <p className="text-xs font-bold text-tm-red">{linkProblem}</p>}
          {warnings.map((w) => (
            <p key={w} className="rounded-lg bg-tm-tint-gold px-2 py-1 text-xs text-tm-gold-ink">
              Warning: {w}
            </p>
          ))}
          <div>
            <p className="text-[11px] font-bold text-slate-700">Preview (sample data)</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-tm-tint-green px-3 py-2 font-sans text-xs text-slate-800">
              {unknown.length ? 'Fix the placeholders to see the preview.' : preview(info, body, support)}
            </pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || unknown.length > 0 || !!linkProblem || !body.trim()}
              onClick={() => void put({ key: info.key, title, subject: template.subject || title, body }, 'save')}
              className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-black px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy === 'save' ? 'Saving…' : 'Save template'}
            </button>
            <button
              type="button"
              disabled={busy !== null || isDefault}
              onClick={() => void put({ key: info.key, reset: true }, 'reset')}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-gray-200 px-4 text-xs font-bold text-slate-700 disabled:opacity-50"
            >
              <RotateCcw aria-hidden size={13} /> {busy === 'reset' ? 'Resetting…' : 'Reset to default'}
            </button>
          </div>
        </div>
        <aside className="rounded-lg border border-gray-200 bg-tm-bg p-2 text-[11px]">
          <p className="font-bold text-slate-700">Placeholders</p>
          <ul className="mt-1 space-y-1">
            {info.placeholders.map((p) => (
              <li key={p}>
                <code className="font-bold text-tm-navy">{`{${p}}`}</code>
                <span className="block text-gray-600">{(PARENTS_GROUP.some((t) => t.key === info.key) ? (PARENT_PLACEHOLDER_HELP as Record<string, string>)[p] : undefined) ??
                    (STATUS_PLACEHOLDER_HELP as Record<string, string>)[p] ??
                    PLACEHOLDER_HELP[p] ??
                    (FU_PLACEHOLDER_HELP as Record<string, string>)[p] ??
                    ''}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </details>
  )
}
