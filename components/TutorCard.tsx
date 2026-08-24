'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface TutorCardProps {
  tutor: {
    id?: string | number
    user_id?: string
    full_name?: string
    avatar_url?: string
    rating?: number | string
    reviews_count?: number | string
    subjects?: string
    headline?: string
    gender?: string
    degree?: string
    city?: string
    hourly_rate?: number | string
    phone?: string
    whatsapp?: string
  }
  isSaved: boolean
  onToggleBookmark: (tutorId: string, e: React.MouseEvent) => void
}

export default function TutorCard({ tutor, isSaved, onToggleBookmark }: TutorCardProps) {
  const [showModal, setShowModal] = useState(false)
  const [myJobs, setMyJobs] = useState<any[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const supabase = createClient()
  const tutorId = String(tutor.id || tutor.user_id || '')
  const avatarUrl = tutor.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tutor.full_name || 'Tutor'}`
  const tutorPhone = tutor.phone || tutor.whatsapp || '923215872222'
  const whatsappLink = `https://wa.me/${tutorPhone}?text=Assalam-o-Alaikum%20${encodeURIComponent(tutor.full_name || 'Tutor')},%20I%20found%20your%20profile%20on%20TutorMint%20and%20want%20to%20discuss%20tuition.`

  const handleOpenInviteModal = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert("🔒 Please log in as a parent to invite tutors to your open jobs.")
      window.location.href = "/parent/login"
      return
    }

    setShowModal(true)
    setLoadingJobs(true)
    try {
      // Fetch only active/open jobs from Supabase directly
      const { data, error } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('parent_id', user.id)
        .neq('status', 'Closed')

      if (error) throw error

      // Double check client-side filtering for safety against null or casing variations
      const activeJobs = (data || []).filter(job => {
        const status = job.status ? job.status.toLowerCase().trim() : 'active'
        return status !== 'closed'
      })
      
      setMyJobs(activeJobs)
      if (activeJobs.length > 0) {
        setSelectedJobId(activeJobs[0].id)
      }
    } catch (err) {
      console.error("Error fetching jobs:", err)
    } finally {
      setLoadingJobs(false)
    }
  }

  const handleConfirmInvite = async () => {
    if (!selectedJobId) {
      alert("Please select an open job to invite this tutor.")
      return
    }

    setSubmitting(true)
    try {
      const { error: updateError } = await supabase
        .from('parent_jobs')
        .update({ status: 'Closed' })
        .eq('id', selectedJobId)

      if (updateError) throw updateError

      setSuccessMsg("🎉 Tutor successfully invited and job automatically closed!")
      setTimeout(() => {
        setShowModal(false)
        setSuccessMsg('')
        window.location.reload()
      }, 2000)
    } catch (err: any) {
      console.error("Error hiring/inviting tutor:", err)
      alert(`Error: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:shadow-md transition-all relative">
        
        {/* Left: Round Avatar with Heart Badge */}
        <div className="flex items-center gap-6 w-full sm:w-auto">
          <div className="relative shrink-0">
            <img 
              src={avatarUrl} 
              alt={tutor.full_name || 'Tutor'} 
              className="h-20 w-20 sm:h-24 sm:w-24 aspect-square rounded-full object-cover bg-gray-50 border-2 border-gray-100 shadow-sm" 
            />
            <button 
              onClick={(e) => onToggleBookmark(tutorId, e)}
              className="absolute bottom-0 right-0 p-2 bg-white hover:bg-red-50 rounded-full border border-gray-200 shadow-sm transition-all text-xs flex items-center justify-center text-red-600"
              title={isSaved ? "Remove from Shortlist" : "Shortlist Tutor"}
            >
              {isSaved ? '❤️' : '🤍'}
            </button>
          </div>

          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href={`/browse/${tutorId}`} className="text-base sm:text-lg font-black text-[#0F172A] hover:underline">
                {tutor.full_name || 'Verified Tutor'}
              </Link>
              
              <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[11px] font-bold rounded-lg border border-blue-100">
                ✓ Verified
              </span>

              <span className="px-2.5 py-1 bg-amber-50 text-amber-800 text-[11px] font-extrabold rounded-lg border border-amber-200 flex items-center gap-1">
                ⭐ {tutor.rating || '5.0'} <span className="text-gray-400 font-normal">({tutor.reviews_count || '12'})</span>
              </span>
            </div>
            
            <p className="text-xs sm:text-sm font-bold text-[#0d9488]">
              {tutor.subjects ? `Expert in ${tutor.subjects}` : (tutor.headline || 'Expert Tutor')} 
              {tutor.gender ? ` • ${tutor.gender}` : ''}
            </p>

            <p className="text-xs text-gray-600 flex flex-wrap items-center gap-3 font-medium">
              <span>🎓 {tutor.degree || 'Qualified Educator'}</span>
              <span>•</span>
              <span>📍 {tutor.city || 'Available Online & Home'}</span>
              <span>•</span>
              <span className="font-bold text-[#0F172A]">💰 {tutor.hourly_rate ? `Rs. ${tutor.hourly_rate}/hr` : 'Negotiable'}</span>
            </p>
          </div>
        </div>

        {/* Right: Action Buttons (Invite, WhatsApp, View Profile) */}
        <div className="w-full sm:w-auto flex flex-wrap items-center gap-2.5 justify-end shrink-0 pt-2 sm:pt-0">
          <button
            onClick={handleOpenInviteModal}
            className="px-4 py-3 bg-[#d60008] hover:bg-red-700 text-white font-black text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
          >
            🎯 Invite to Job
          </button>
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
          >
            💬 WhatsApp
          </a>
          <Link
            href={`/browse/${tutorId}`}
            className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-[#0F172A] font-bold text-xs rounded-xl transition-all border border-gray-200"
          >
            View Profile
          </Link>
        </div>
      </div>

      {/* Invite to Job Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white p-6 sm:p-8 rounded-3xl max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-lg font-black text-[#0F172A]">Invite {tutor.full_name} to Your Job</h3>
            <p className="text-xs text-gray-600">Select one of your active job listings below. Hiring this tutor will automatically close the job.</p>

            {successMsg ? (
              <div className="p-4 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-2xl border border-emerald-200">
                {successMsg}
              </div>
            ) : loadingJobs ? (
              <p className="text-xs text-gray-400 py-6 text-center">Loading your open jobs...</p>
            ) : myJobs.length === 0 ? (
              <div className="space-y-3 py-4 text-center">
                <p className="text-xs text-red-600 font-bold">You have no active open jobs right now.</p>
                <Link href="/parent/dashboard/post-job" className="inline-block px-5 py-2.5 bg-[#0F172A] text-white text-xs font-bold rounded-xl">
                  Post a Job First ➔
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700">Select Open Job:</label>
                  <select 
                    value={selectedJobId} 
                    onChange={(e) => setSelectedJobId(e.target.value)}
                    className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-semibold text-[#1E293B] outline-none"
                  >
                    {myJobs.map(job => (
                      <option key={job.id} value={job.id}>
                        {job.title} ({job.city})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button 
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleConfirmInvite}
                    disabled={submitting}
                    className="px-6 py-2.5 bg-[#d60008] hover:bg-red-700 text-white font-black text-xs rounded-xl shadow-md"
                  >
                    {submitting ? 'Processing...' : 'Confirm Hire & Close Job 🚀'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}