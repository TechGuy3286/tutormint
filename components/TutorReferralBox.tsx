'use client'

import { useState } from 'react'

export default function TutorReferralBox({ tutorUniqueId, profileCompleted }: { tutorUniqueId: string, profileCompleted: boolean }) {
  const [copied, setCopied] = useState(false)

  if (!profileCompleted) {
    return (
      <div className="bg-gray-50 border border-gray-200 p-6 rounded-3xl text-center text-xs text-gray-500 space-y-1">
        <p className="font-bold text-slate-900">🔒 Referral Program Locked</p>
        <p>Complete your profile to 100% to unlock your exclusive referral link and invite fellow tutors!</p>
      </div>
    )
  }

  const referralLink = `${typeof window !== 'undefined' ? window.location.origin : 'https://www.tutormint.org'}/tutor/register?ref=${tutorUniqueId}`

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-3xl space-y-3 shadow-sm">
      <h3 className="text-xs font-black uppercase tracking-wider text-emerald-900">🎁 Refer a Fellow Tutor</h3>
      <p className="text-xs text-emerald-700 leading-relaxed">
        Your profile is fully verified! Share your unique referral link below to invite other educators to TutorMint.
      </p>
      <div className="flex gap-2">
        <input 
          type="text" 
          readOnly 
          value={referralLink} 
          className="flex-1 p-3 bg-white border border-emerald-200 rounded-xl text-xs font-mono text-slate-800 outline-none" 
        />
        <button 
          onClick={handleCopy} 
          className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold rounded-xl transition-all shadow-sm whitespace-nowrap"
        >
          {copied ? '✅ Copied!' : '📋 Copy Link'}
        </button>
      </div>
    </div>
  )
}