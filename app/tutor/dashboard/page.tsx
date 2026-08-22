'use client'

import { useState, useEffect } from 'react'

export default function TutorDashboardPage() {
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string>('test.tutor@tutormint.com')
  const [notification, setNotification] = useState('🔍 A parent in DHA Phase 5 viewed your profile (2 mins ago)')
  const [referralCopied, setReferralCopied] = useState(false)
  const [appliedJobs, setAppliedJobs] = useState<number[]>([])

  useEffect(() => {
    const loggedIn = localStorage.getItem('tm_logged_in')
    const email = localStorage.getItem('tm_email')

    // If storage is empty, auto-initialize the test session so direct access never bounces back
    if (!loggedIn && !email) {
      localStorage.setItem('tm_logged_in', 'true')
      localStorage.setItem('tm_email', 'test.tutor@tutormint.com')
    }

    setUserEmail(localStorage.getItem('tm_email') || 'test.tutor@tutormint.com')
    setLoading(false)
  }, [])

  const handleLogout = () => {
    localStorage.clear()
    window.location.href = '/login'
  }

  const tutorData = {
    id: 'TM-8821',
    name: 'Sir Bilal Ahmed',
    title: 'Expert O/A Level Mathematics & Physics Tutor',
    area: 'DHA Phase 5, Lahore',
    description: 'Over 5 years of verified experience helping students score A* grades in Cambridge exams.',
    profileLink: 'https://www.tutormint.org/tutor/sir-bilal-ahmed',
    demoRating: '4.9 ★',
    methodRating: '4.8 ★',
    trialStatus: 'First Month Free Trial Active (Trust Fee 199 PKR due on completion)',
    verifications: {
      video: 'Approved & Verified ✓',
      cnic: 'Verified via NADRA ✓',
      degree: 'Physical Degree Audited ✓'
    }
  }

  const nearbyLeads = [
    {
      id: 1,
      subject: 'O-Level Mathematics (Class 10)',
      location: 'DHA Phase 5, Lahore',
      budget: '35,000 PKR / month',
      timing: 'Evening (4:00 PM - 6:00 PM)',
      posted: '15 mins ago'
    },
    {
      id: 2,
      subject: 'A-Level Physics (H2 / Mechanics)',
      location: 'Gulberg III, Lahore',
      budget: '45,000 PKR / month',
      timing: 'Flexible Weekdays',
      posted: '1 hour ago'
    },
    {
      id: 3,
      subject: 'Grade 9 General Science & Math',
      location: 'Model Town, Lahore',
      budget: '25,000 PKR / month',
      timing: 'After School',
      posted: '3 hours ago'
    }
  ]

  const handleApplyJob = (id: number) => {
    if (!appliedJobs.includes(id)) {
      setAppliedJobs([...appliedJobs, id])
    }
  }

  const whatsappShareText = encodeURIComponent(
    `🎓 *TutorMint Verified Tutor Profile*\n\n` +
    `*Name:* ${tutorData.name}\n` +
    `*Title:* ${tutorData.title}\n` +
    `*Area:* ${tutorData.area}\n\n` +
    `"${tutorData.description}"\n\n` +
    `🔗 *View & Connect Directly (Zero Commission):*\n${tutorData.profileLink}`
  )

  const handleWhatsAppShare = () => {
    window.open(`https://wa.me/?text=${whatsappShareText}`, '_blank')
  }

  const handleCopyReferral = () => {
    navigator.clipboard.writeText('https://www.tutormint.org/register?ref=TM-8821')
    setReferralCopied(true)
    setTimeout(() => setReferralCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Loading Tutor Dashboard...
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Top Bar with Logout */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex justify-between items-center">
          <div className="text-xs font-bold text-slate-700">
            Signed in as: <span className="text-emerald-600">{userEmail}</span>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold uppercase rounded-xl transition-all"
          >
            Log Out
          </button>
        </div>

        {/* Live Alert Banner */}
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse"></span>
            <p className="text-xs font-bold text-emerald-900">{notification}</p>
          </div>
          <span className="text-[10px] font-mono text-emerald-700 uppercase bg-emerald-100 px-2.5 py-1 rounded-full font-semibold">
            Live Alert
          </span>
        </div>

        {/* Profile Header & Status Card */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-slate-400 bg-gray-100 px-2 py-0.5 rounded">{tutorData.id}</span>
              <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200">
                100% Profile Completed ✓
              </span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 mt-2">{tutorData.name}</h1>
            <p className="text-sm font-medium text-slate-600">{tutorData.title}</p>
            <p className="text-xs text-gray-400">📍 {tutorData.area}</p>
          </div>

          <div className="bg-slate-900 text-white p-5 rounded-xl text-center space-y-1 w-full md:w-auto">
            <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400">Billing Status</span>
            <p className="text-xs font-medium text-gray-200 max-w-[220px]">{tutorData.trialStatus}</p>
          </div>
        </div>

        {/* NEW: Verification & Badge Center */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Camera & Credential Verification Status</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Video Interview</span>
              <p className="text-xs font-bold text-emerald-600">{tutorData.verifications.video}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase">CNIC Status</span>
              <p className="text-xs font-bold text-emerald-600">{tutorData.verifications.cnic}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Academic Degree</span>
              <p className="text-xs font-bold text-emerald-600">{tutorData.verifications.degree}</p>
            </div>
          </div>
        </div>

        {/* NEW: Nearby Tuition Leads Feed */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Active Tuition Leads Near You</h2>
              <p className="text-xs text-gray-500 mt-0.5">Parents actively looking for verified tutors in your preferred zones.</p>
            </div>
            <span className="px-3 py-1 bg-red-50 text-red-600 font-bold text-[10px] uppercase tracking-widest rounded-full border border-red-100">
              3 New Today
            </span>
          </div>

          <div className="space-y-4">
            {nearbyLeads.map((lead) => {
              const hasApplied = appliedJobs.includes(lead.id)
              return (
                <div key={lead.id} className="p-5 bg-gray-50 border border-gray-200 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{lead.subject}</span>
                      <span className="text-[10px] text-gray-400 font-mono">• {lead.posted}</span>
                    </div>
                    <p className="text-xs text-gray-600">📍 {lead.location} | ⏰ {lead.timing}</p>
                    <p className="text-xs font-black text-emerald-600">{lead.budget}</p>
                  </div>

                  <button
                    onClick={() => handleApplyJob(lead.id)}
                    disabled={hasApplied}
                    className={`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all whitespace-nowrap ${
                      hasApplied 
                        ? 'bg-emerald-100 text-emerald-800 cursor-default' 
                        : 'bg-black hover:bg-emerald-600 text-white shadow'
                    }`}
                  >
                    {hasApplied ? 'Applied ✓' : 'Apply for Lead'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Two-Tier Ratings Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Demo Class Rating</span>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{tutorData.demoRating}</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Based on demo acceptance & response speed</p>
            </div>
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center text-xl font-bold">
              ★
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Teaching Method Rating</span>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{tutorData.methodRating}</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Based on parent post-tuition feedback</p>
            </div>
            <div className="w-12 h-12 bg-slate-100 text-slate-900 rounded-2xl flex items-center justify-center text-xl font-bold">
              📚
            </div>
          </div>
        </div>

        {/* WhatsApp Profile Sharing Section */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Share Profile on WhatsApp</h2>
            <p className="text-xs text-gray-500 mt-1">
              Instantly broadcast your verified profile card, description, and direct link to WhatsApp groups or prospective parents.
            </p>
          </div>

          <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2 font-mono text-xs text-slate-700">
            <p><strong>Name:</strong> {tutorData.name}</p>
            <p><strong>Title:</strong> {tutorData.title}</p>
            <p className="text-gray-500 italic">"{tutorData.description}"</p>
            <p className="text-emerald-600 underline">{tutorData.profileLink}</p>
          </div>

          <button
            onClick={handleWhatsAppShare}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs tracking-widest uppercase rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
          >
            <span>💬 Share Directly to WhatsApp</span>
          </button>
        </div>

        {/* Refer-a-Friend Section */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Refer a Fellow Tutor</h2>
            <p className="text-xs text-gray-500 mt-1">
              Help grow Pakistan's largest verified tutor network. Share your unique referral link with qualified colleagues.
            </p>
          </div>
          <button
            onClick={handleCopyReferral}
            className="w-full md:w-auto px-6 py-3.5 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs tracking-wider uppercase rounded-xl shadow transition-all whitespace-nowrap"
          >
            {referralCopied ? 'Referral Link Copied! ✓' : 'Copy Referral Link'}
          </button>
        </div>

      </div>
    </main>
  )
}