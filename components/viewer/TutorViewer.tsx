'use client'

import { createContext, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, MessageCircle, Phone } from 'lucide-react'
import { useHeaderSession } from '@/components/session/HeaderSessionProvider'
import ProfileActions from '@/app/(site)/tutor/[slug]/ProfileActions'
import ReportButton from '@/components/ReportButton'
import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import { waSendHref } from '@/lib/waLinkCore'
import { ownPreviewPath, showProfileActions, type TutorViewer } from '@/lib/tutorViewerCore'

// The signed-in parts of a cached tutor profile (push 3, owner 1 Nov 2026). The
// page is the same HTML for everyone and renders as a guest sees it; when the
// visitor has a sign-in cookie this asks /api/viewer/tutor once and the parts
// below redraw for them. The phone and WhatsApp come only from that answer, and
// only when the viewer may see them. Every visit is reported once
// (POST /api/viewer/tutor/view) for the tutor's "who viewed you" count.

const Ctx = createContext<TutorViewer | null>(null)

export default function TutorViewerProvider({ tutorId, children }: { tutorId: string; children: React.ReactNode }) {
  const session = useHeaderSession()
  const [viewer, setViewer] = useState<TutorViewer | null>(null)
  const reported = useRef(false)

  useEffect(() => {
    if (session.status === 'checking' || reported.current) return
    reported.current = true
    const body = JSON.stringify({ tutorId, referrer: document.referrer || null })
    try {
      if (!navigator.sendBeacon?.('/api/viewer/tutor/view', new Blob([body], { type: 'application/json' }))) throw new Error('no beacon')
    } catch {
      void fetch('/api/viewer/tutor/view', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {})
    }
  }, [session.status, tutorId])

  useEffect(() => {
    // Signed out: nothing to ask; the value below reads null (no state reset).
    if (session.status !== 'signed-in') return
    let live = true
    fetch(`/api/viewer/tutor?id=${encodeURIComponent(tutorId)}`, { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<TutorViewer>) : null))
      .then((v) => live && setViewer(v))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [session.status, tutorId])

  return <Ctx.Provider value={session.status === 'signed-in' ? viewer : null}>{children}</Ctx.Provider>
}

function useViewer(): Extract<TutorViewer, { signedIn: true }> | null {
  const v = useContext(Ctx)
  return v && v.signedIn ? v : null
}

/** One of two texts: for the tutor looking at their own page, or for anyone else. */
export function SelfOrOther({ self, other }: { self: string; other: string }) {
  return <>{useViewer()?.isSelf ? self : other}</>
}

/** The Contact box: locked for a guest and for anyone without contact rights. */
export function TutorContactBox({ tutorName }: { tutorName: string }) {
  const v = useViewer()
  const contact = v?.contactUnlocked ? v.contact : null
  const has = !!(contact?.phone || contact?.whatsapp)
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
      <h2 className="text-sm font-black text-tm-navy">Contact</h2>
      {v?.contactUnlocked && !has ? (
        <p className="mt-3 rounded-xl bg-tm-bg p-4 text-xs text-gray-500">
          {v.isSelf
            ? 'You have not verified a phone number yet. Add one from your dashboard so Featured parents can reach you.'
            : 'This tutor has not added a phone number yet. Request a demo and they will reply here.'}
        </p>
      ) : contact && has ? (
        <div className="space-y-2 pt-3">
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-tm-navy">
              <Phone size={16} className="text-gray-500" />
              {contact.phone}
            </a>
          )}
          {contact.whatsapp && (
            <a
              href={waSendHref(
                contact.whatsapp.replace(/[^0-9]/g, ''),
                `Assalam-o-Alaikum ${tutorName}, I found your profile on TutorMint and would like to discuss tuition.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-tm-green-deep"
            >
              <MessageCircle size={16} />
              WhatsApp {contact.whatsapp}
            </a>
          )}
          {v?.isSelf && <p className="text-[11px] text-gray-500">This is your own profile. Featured parents see these details.</p>}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-tm-bg p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            <Lock size={14} />
            Phone and WhatsApp are hidden
          </p>
          <UpgradeTrigger
            reason="parent_contact"
            intent="message"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-gold px-4 text-xs font-black text-tm-navy"
          >
            See with Featured
          </UpgradeTrigger>
        </div>
      )}
    </section>
  )
}

/** Certificates: the previews for a signed-in visitor, a sign-in line otherwise. */
export function SignedInOnly({ children, guest }: { children: React.ReactNode; guest: React.ReactNode }) {
  return <>{useViewer() ? children : guest}</>
}

/** "Report this profile" — signed in, and not your own profile. */
export function ProfileReport({ tutorId }: { tutorId: string }) {
  const v = useViewer()
  if (!v || v.isSelf) return null
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
      <ReportButton reportedId={tutorId} targetType="profile" label="Report this profile" />
    </section>
  )
}

/** The sticky action bar (Shortlist, Demo, Message, Hire). */
export function ProfileActionsIsland({ tutorId, tutorName, underReview }: { tutorId: string; tutorName: string; underReview: boolean }) {
  const raw = useContext(Ctx)
  const v = useViewer()
  const session = useHeaderSession()
  // While a signed-in visitor is still being looked up, draw nothing rather
  // than a guest bar that would change under their finger.
  if (session.status === 'checking' || (session.status === 'signed-in' && !raw)) return null
  if (!showProfileActions(raw, underReview)) return null
  return (
    // ProfileActions reads ?message=1 / ?demo=1; on a cached page that needs a
    // Suspense boundary.
    <Suspense fallback={null}>
      <ProfileActions
        key={v ? 'viewer' : 'guest'}
        tutorId={tutorId}
        tutorName={tutorName}
        signedIn={!!v}
        isSelf={!!v?.isSelf}
        initiallySaved={!!v?.saved}
        canMessage={!v || v.audience !== 'tutor'}
        isParent={!!v?.isParent}
        hired={!!v?.hired}
      />
    </Suspense>
  )
}

/** On a profile that is not public yet: the tutor themselves goes to their preview. */
export function OwnPreviewRedirect({ slug }: { slug: string }) {
  const session = useHeaderSession()
  const router = useRouter()
  const signedInTutor = session.status === 'signed-in' && session.session.role === 'tutor'
  useEffect(() => {
    if (!signedInTutor) return
    let live = true
    fetch(`/api/viewer/tutor?slug=${encodeURIComponent(slug)}`, { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ isSelf?: boolean }>)
      .then((b) => {
        if (live && b.isSelf) router.replace(ownPreviewPath(slug))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [signedInTutor, slug, router])
  return null
}
