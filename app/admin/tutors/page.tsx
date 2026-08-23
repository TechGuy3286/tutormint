'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function AdminTutorsPage() {
  const [tutors, setTutors] = useState<any[]>([
    {
      id: 'TM-8821',
      name: 'Sir Bilal Ahmed',
      email: 'bilal.ahmed@tutormint.com',
      title: 'Expert O/A Level Mathematics & Physics',
      area: 'DHA Phase 5, Lahore',
      status: 'pending',
      video_proof: 'https://www.youtube.com/watch?v=sample-video-proof',
      cnic: '35202-1234567-1',
      degree: 'BS Mathematics (LUMS)',
      applied_date: 'Today, 2:15 PM'
    },
    {
      id: 'TM-8822',
      name: 'Dr. Maria Khan',
      email: 'maria.khan@tutormint.com',
      title: 'Biology & Chemistry Specialist',
      area: 'Clifton, Karachi',
      status: 'active',
      video_proof: 'https://www.youtube.com/watch?v=sample-video-proof-2',
      cnic: '42101-9876543-2',
      degree: 'MBBS / MPhil (Aga Khan)',
      applied_date: 'Yesterday'
    },
    {
      id: 'TM-8823',
      name: 'Usman Tariq',
      email: 'usman.tariq@tutormint.com',
      title: 'Computer Science & Python Tutor',
      area: 'F-7, Islamabad',
      status: 'pending',
      video_proof: 'https://www.youtube.com/watch?v=sample-video-proof-3',
      cnic: '61101-5544332-3',
      degree: 'BS Software Engineering (NUST)',
      applied_date: '2 days ago'
    }
  ])

  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'active'>('all')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    // Update local state instantly for smooth UI feedback
    setTutors(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t))

    try {
      // If connected to Supabase, update the database
      const { error } = await supabase
        .from('tutors')
        .update({ status: newStatus })
        .eq('id', id)

      if (error) {
        console.warn("Supabase update notice: running in local sync mode.", error.message)
      }
    } catch (err: any) {
      console.error("Error updating tutor status:", err.message)
    }
  }

  const filteredTutors = tutors.filter(t => {
    if (filterStatus === 'pending') return t.status === 'pending'
    if (filterStatus === 'active') return t.status === 'active'
    return true
  })

  const pendingCount = tutors.filter(t => t.status === 'pending').length
  const activeCount = tutors.filter(t => t.status === 'active').length

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-12 px-4 sm:px-6 lg:px-8 text-[#334155]">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Top Header */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1">
            <span className="px-3 py-1 bg-red-50 text-[#d60008] border border-red-200 text-[10px] font-bold uppercase tracking-widest rounded-full">
              Restricted Admin Control Center
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A] mt-2">
              Tutor Credential Verification & Approvals
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">
              Review video proofs, NADRA CNIC verifications, and physical degree audits before activating educator profiles.
            </p>
          </div>

          <button 
            onClick={() => router.push('/parent/dashboard')}
            className="px-5 py-3 bg-[#0F172A] hover:bg-black text-white text-xs font-bold uppercase rounded-xl transition-all shadow-md"
          >
            ← Back to Platform
          </button>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Registered</span>
              <h3 className="text-3xl font-black text-[#0F172A] mt-1">{tutors.length}</h3>
            </div>
            <div className="w-12 h-12 bg-slate-100 text-[#0F172A] rounded-2xl flex items-center justify-center text-xl font-bold">
              👥
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pending Review</span>
              <h3 className="text-3xl font-black text-[#d60008] mt-1">{pendingCount}</h3>
            </div>
            <div className="w-12 h-12 bg-red-50 text-[#d60008] rounded-2xl flex items-center justify-center text-xl font-bold">
              ⏳
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Verified & Active</span>
              <h3 className="text-3xl font-black text-[#059669] mt-1">{activeCount}</h3>
            </div>
            <div className="w-12 h-12 bg-emerald-50 text-[#059669] rounded-2xl flex items-center justify-center text-xl font-bold">
              ✓
            </div>
          </div>
        </div>

        {/* Filter Tabs & Tutor List */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-200 space-y-6">
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-6">
            <h2 className="text-sm font-black uppercase tracking-wider text-[#0F172A]">
              Tutor Submissions Queue
            </h2>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  filterStatus === 'all' 
                    ? 'bg-[#0F172A] text-white' 
                    : 'bg-[#F8FAFC] text-gray-600 hover:bg-gray-200'
                }`}
              >
                All ({tutors.length})
              </button>
              <button
                onClick={() => setFilterStatus('pending')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  filterStatus === 'pending' 
                    ? 'bg-[#d60008] text-white' 
                    : 'bg-red-50 text-[#d60008] hover:bg-red-100'
                }`}
              >
                Pending ({pendingCount})
              </button>
              <button
                onClick={() => setFilterStatus('active')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  filterStatus === 'active' 
                    ? 'bg-[#059669] text-white' 
                    : 'bg-emerald-50 text-[#059669] hover:bg-emerald-100'
                }`}
              >
                Active ({activeCount})
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {filteredTutors.length === 0 ? (
              <div className="text-center py-12 text-xs font-bold text-gray-400">
                No tutors found in this category.
              </div>
            ) : (
              filteredTutors.map((tutor) => (
                <div 
                  key={tutor.id} 
                  className="p-6 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono font-bold text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">
                        {tutor.id}
                      </span>
                      <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                        tutor.status === 'active' 
                          ? 'bg-emerald-100 text-[#059669]' 
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {tutor.status === 'active' ? 'Verified & Active ✓' : 'Pending Audit ⏳'}
                      </span>
                      <span className="text-[10px] text-gray-400 font-medium">• Applied {tutor.applied_date}</span>
                    </div>

                    <h3 className="text-base font-black text-[#0F172A]">{tutor.name}</h3>
                    <p className="text-xs font-medium text-slate-600">{tutor.title} • 📍 {tutor.area}</p>
                    
                    <div className="pt-2 flex flex-wrap gap-3 text-[11px] text-gray-500 font-mono">
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-gray-200">🎓 {tutor.degree}</span>
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-gray-200">🆔 CNIC: {tutor.cnic}</span>
                      <a 
                        href={tutor.video_proof} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg border border-blue-200 font-bold hover:underline"
                      >
                        🎥 Inspect Video Proof ➔
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full lg:w-auto justify-end">
                    {tutor.status === 'pending' ? (
                      <button
                        onClick={() => handleUpdateStatus(tutor.id, 'active')}
                        className="px-5 py-3 bg-[#059669] hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md whitespace-nowrap"
                      >
                        Approve & Verify ✓
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpdateStatus(tutor.id, 'pending')}
                        className="px-5 py-3 bg-red-50 hover:bg-red-100 text-[#d60008] font-bold text-xs uppercase rounded-xl transition-all whitespace-nowrap"
                      >
                        Suspend / Re-verify
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

        </div>

      </div>
    </main>
  )
}