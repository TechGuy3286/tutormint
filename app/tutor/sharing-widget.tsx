'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function SharingAndTrialWidget({ tutor }: { tutor: any }) {
  const [copiedRef, setCopiedRef] = useState(false)

  // Format WhatsApp Share text
  const whatsappText = encodeURIComponent(
    `🎓 *Verified Tutor Profile | TutorMint Pakistan*\n\n` +
    `*Title:* ${tutor?.title || 'Expert Educator'}\n` +
    `*About:* ${tutor?.bio || 'Camera-verified professional educator ready for home & online tuition.'}\n\n` +
    `🔗 *View Profile & Hire Directly (Zero Commission):*\nhttps://tutormint.org/tutor/${tutor?.user_id}`
  )

  const whatsappShareUrl = `https://api.whatsapp.com/send?text=${whatsappText}`

  // Referral Link
  const referralLink = `https://tutormint.org/register?ref=${tutor?.internal_id || 'TM-REF'}`

  const handleCopyReferral = () => {
    navigator.clipboard.writeText(referralLink)
    setCopiedRef(true)
    setTimeout(() => setCopiedRef(false), 2500)
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
      {/* 1. Trial & Trust Fee Status Card */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4 flex flex-col justify-between">
        <div className="space-y-2">
          <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase rounded-full">
            Free Trial Active
          </span>
          <h3 className="text-lg font-bold text-slate-900">1st Month Trial Status</h3>
          <p className="text-xs text-gray-500">
            Your first month is completely free as a trial period. Upon completion, secure your permanent verified badge with the 199 PKR Trust Fee.
          </p>
        </div>
        <Link
          href="/tutor/trust-fee"
          className="block text-center py-3 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs uppercase rounded-xl transition-all"
        >
          View Trust Fee Details (199 PKR)
        </Link>
      </div>

      {/* 2. One-Click WhatsApp Sharing Card */}
      <div className="bg-emerald-600 text-white p-6 rounded-2xl shadow-md space-y-4 flex flex-col justify-between">
        <div className="space-y-2">
          <span className="px-3 py-1 bg-white/20 text-white text-[10px] font-bold uppercase rounded-full">
            Instant Growth
          </span>
          <h3 className="text-lg font-bold">Share Profile on WhatsApp</h3>
          <p className="text-xs text-emerald-100">
            Instantly share your verified profile card, photo preview, title, and direct booking link with parent networks on WhatsApp.
          </p>
        </div>
        <a
          href={whatsappShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center py-3 bg-white text-emerald-900 hover:bg-emerald-50 font-bold text-xs uppercase rounded-xl transition-all shadow-lg"
        >
          Share to WhatsApp Now 📱
        </a>
      </div>

      {/* 3. Peer Referral System Card */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4 flex flex-col justify-between">
        <div className="space-y-2">
          <span className="px-3 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase rounded-full">
            Peer Referral
          </span>
          <h3 className="text-lg font-bold text-slate-900">Invite Fellow Tutors</h3>
          <p className="text-xs text-gray-500">
            As a 100% verified educator, share your unique referral link to bring trusted colleagues into the TutorMint network.
          </p>
        </div>
        <button
          onClick={handleCopyReferral}
          className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs uppercase rounded-xl transition-all"
        >
          {copiedRef ? '✓ Referral Link Copied!' : 'Copy Unique Referral Link'}
        </button>
      </div>
    </div>
  )
}