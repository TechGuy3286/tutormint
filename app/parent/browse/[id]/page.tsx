'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function TutorProfilePage() {
  const [tutor, setTutor] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const params = useParams()
  const supabase = createClient()

  useEffect(() => {
    if (params?.id) {
      fetchTutorProfile(params.id as string)
    }
  }, [params])

  const fetchTutorProfile = async (id: string) => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('tutors')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error
      setTutor(data)
    } catch (err) {
      console.error('Error fetching tutor profile:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-400">Loading tutor profile...</div>
  }

  if (!tutor) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-3 bg-[#F8FAFC] text-center p-6">
        <h2 className="text-base font-black text-[#0F172A]">Tutor Profile Not Found</h2>
        <p className="text-xs text-gray-500">The tutor you are looking for may have been removed or is no longer available.</p>
        <Link href="/parent/browse" className="px-6 py-3 bg-[#0F172A] text-white font-bold text-xs rounded-xl">
          ← Back to Tutors Directory
        </Link>
      </div>
    )
  }

  const avatarUrl = tutor.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tutor.full_name || 'Tutor'}`

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-10 px-4 sm:px-12 text-[#334155]">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Back Button */}
        <Link href="/parent/browse" className="inline-flex items-center text-xs font-bold text-gray-500 hover:text-[#0F172A] transition-colors">
          ← Back to Search Results
        </Link>

        {/* Profile Header Card */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <img 
              src={avatarUrl} 
              alt={tutor.full_name || 'Tutor'} 
              className="h-24 w-24 sm:h-28 sm:w-28 aspect-square rounded-3xl object-cover bg-gray-100 border border-gray-200 shadow-sm shrink-0" 
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">{tutor.full_name || 'Verified Tutor'}</h1>
                <span className="px-2.5 py-1 bg-amber-50 text-amber-800 text-xs font-extrabold rounded-lg border border-amber-200 flex items-center gap-1">
                  ⭐ {tutor.rating || '5.0'} ({tutor.reviews_count || '12'} reviews)
                </span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-[#0d9488]">
                {tutor.subjects ? `Expert in ${tutor.subjects}` : (tutor.headline || 'Expert Tutor')}
              </p>
              <p className="text-xs text-gray-500 flex flex-wrap items-center gap-3">
                <span>🎓 {tutor.degree || 'Qualified Educator'}</span>
                <span>•</span>
                <span>📍 {tutor.city || 'Available Online & On-site'}</span>
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto flex flex-col gap-2 shrink-0">
            <Link
              href={`/parent/dashboard/messages?tutor=${tutor.id}`}
              className="w-full text-center px-8 py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-md transition-all"
            >
              Hire / Contact Tutor ➔
            </Link>
          </div>
        </div>

        {/* Detailed Information Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Left / Main Column: About & Bio */}
          <div className="md:col-span-2 space-y-6">
            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
              <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-wider">About Educator</h3>
              <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                {tutor.bio || 'Dedicated educator focused on building strong conceptual foundations, fostering critical thinking, and ensuring student success in academic examinations.'}
              </p>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
              <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-wider">Subjects & Expertise</h3>
              <div className="flex flex-wrap gap-2">
                {(tutor.subjects ? tutor.subjects.split(',') : ['General Tutoring', 'Academic Coaching']).map((subj: string, idx: number) => (
                  <span key={idx} className="px-3 py-1.5 bg-[#F8FAFC] text-[#334155] border border-gray-200 text-xs font-bold rounded-xl">
                    {subj.trim()}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Key Details Sidebar */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-4">
              <h3 className="text-xs font-black text-[#0F172A] uppercase tracking-wider">Session Details</h3>
              
              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-400 font-medium">Expected Fee</span>
                  <span className="font-black text-[#0F172A]">{tutor.hourly_rate ? `Rs. ${tutor.hourly_rate}/hr` : 'Negotiable'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-400 font-medium">Preferred Slot</span>
                  <span className="font-bold text-[#334155]">{tutor.time_slot || 'Flexible'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-400 font-medium">Gender</span>
                  <span className="font-bold text-[#334155]">{tutor.gender || 'Not Specified'}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-400 font-medium">Location</span>
                  <span className="font-bold text-[#334155]">{tutor.city || 'Online / Home'}</span>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </main>
  )
}