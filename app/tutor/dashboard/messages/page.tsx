'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function TutorMessagesPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState<any[]>([
    {
      id: '1',
      parent_name: 'Mrs. Alvi',
      subject: 'O-Level Physics (DHA Phase 5)',
      preview: 'Hello Sir, we need an experienced tutor for ...',
      time: '10 mins ago'
    },
    {
      id: '2',
      parent_name: 'Dr. Tariq',
      subject: 'A-Level Chemistry',
      preview: 'Assalam-o-Alaikum, looking for 3 days a we...',
      time: '2 hours ago'
    }
  ])
  const [selectedRequest, setSelectedRequest] = useState<any>(null)
  const [showNonPremiumModal, setShowNonPremiumModal] = useState(false)

  useEffect(() => {
    // Simulate loading data or fetch from Supabase if table exists
    setLoading(false)
  }, [])

  const handleAcceptClick = (req: any) => {
    setSelectedRequest(req)
    // Instantly trigger the non-premium restriction pop-up
    setShowNonPremiumModal(true)
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6 flex-1 w-full text-[#334155] font-sans">
      
      {/* BREADCRUMB HEADER */}
      <div className="flex items-center justify-between bg-white px-5 py-3.5 rounded-2xl border border-gray-200 shadow-2xs">
        <div className="flex items-center space-x-2 text-xs font-bold text-gray-500">
          <Link href="/tutor/dashboard" className="hover:text-[#0F172A] transition-colors">Tutor Dashboard</Link>
          <span className="text-gray-300">/</span>
          <span className="text-[#059669]">Messages & Requests</span>
        </div>
        <Link 
          href="/tutor/dashboard" 
          className="px-4 py-2 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl transition-all shadow-xs"
        >
          Dashboard ➔
        </Link>
      </div>

      {/* BANNER CARD */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-2">
        <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Parent Message Requests & Inbox</h1>
        <p className="text-xs sm:text-sm text-gray-600 font-medium">
          Parents cannot chat directly until you accept their connection request. Accepting a request requires an active membership status.
        </p>
      </div>

      {/* GRID CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* INCOMING REQUESTS LIST */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-4">
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">Incoming Requests ({requests.length})</h3>
          
          <div className="space-y-4">
            {requests.map((req) => (
              <div key={req.id} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-extrabold text-[#0F172A] text-sm">{req.parent_name}</h4>
                    <p className="text-xs font-bold text-emerald-700">{req.subject}</p>
                  </div>
                  <span className="text-[11px] text-gray-400 font-medium">{req.time}</span>
                </div>
                <p className="text-xs text-gray-600 italic">"{req.preview}"</p>
                <button 
                  onClick={() => handleAcceptClick(req)}
                  className="w-full py-3 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Accept Request (199 PKR)
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* CHAT / EMPTY STATE BOX */}
        <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col items-center justify-center text-center min-h-[350px]">
          <span className="text-3xl mb-3">💬</span>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Select an accepted request to start chatting
          </p>
        </div>

      </div>

      {/* NON-PREMIUM RESTRICTION POP-UP MODAL */}
      {showNonPremiumModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white p-8 rounded-3xl max-w-md w-full space-y-6 shadow-2xl border border-gray-200 text-center">
            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center text-2xl mx-auto font-black">
              🔒
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-[#0F172A]">Premium Membership Required</h3>
              <p className="text-xs text-gray-600 font-medium leading-relaxed">
                Because you are not a premium member, you can accept the request, but you cannot send any response or chat messages to verified members. Upgrade your account to unlock unlimited messaging and direct parent connections.
              </p>
            </div>
            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={() => setShowNonPremiumModal(false)}
                className="w-full py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer"
              >
                Upgrade to Premium Now ➔
              </button>
              <button
                onClick={() => setShowNonPremiumModal(false)}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-[#0F172A] font-bold text-xs uppercase rounded-xl transition-all cursor-pointer"
              >
                Close & Continue Later
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}