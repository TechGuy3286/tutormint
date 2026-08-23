'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function BrowseContent() {
  const [tutors, setTutors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [modeFilter, setModeFilter] = useState('all') // 'all', 'online', 'home'
  const [isSoftMatch, setIsSoftMatch] = useState(false)

  const supabase = createClient()
  const searchParams = useSearchParams()

  useEffect(() => {
    const initialQuery = searchParams.get('subject') || ''
    if (initialQuery) {
      setSearchTerm(initialQuery)
    }
    fetchTutors(initialQuery)
  }, [searchParams])

  const fetchTutors = async (query = '') => {
    setLoading(true)
    setIsSoftMatch(false)

    try {
      // Base query: fetch all active tutors for open discovery
      let dbQuery = supabase
        .from('tutors')
        .select('*')
        .order('created_at', { ascending: false })

      const { data, error } = await dbQuery

      if (error) throw error

      if (data) {
        if (!query.trim()) {
          setTutors(data)
        } else {
          // Attempt exact/close matching on subjects or headline
          const filtered = data.filter((tutor: any) => 
            tutor.subjects?.toLowerCase().includes(query.toLowerCase()) ||
            tutor.full_name?.toLowerCase().includes(query.toLowerCase()) ||
            tutor.bio?.toLowerCase().includes(query.toLowerCase())
          )

          if (filtered.length > 0) {
            setTutors(filtered)
          } else {
            // Soft Matching Fallback: If no strict match, display all tutors politely instead of empty screen
            setIsSoftMatch(true)
            setTutors(data)
          }
        }
      }
    } catch (err) {
      console.error('Error fetching tutors:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    fetchTutors(searchTerm)
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-10 px-4 sm:px-12 text-[#334155]">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header & Search Bar */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-[#0F172A]">Find Verified Tutors</h1>
            <p className="text-xs text-gray-500">Browse available tutors for home or online sessions and connect instantly.</p>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
            <input 
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by subject (e.g. Math, Physics, English)..."
              className="flex-1 p-3.5 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
            />
            <button
              type="submit"
              className="px-6 py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-md transition-all"
            >
              Search Tutors
            </button>
          </form>
        </div>

        {/* Soft Match Notification Banner */}
        {isSoftMatch && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 font-medium flex items-center justify-between">
            <span>⚠️ We couldn't find an exact match for your search, but here are all available top tutors ready to help!</span>
            <button onClick={() => { setSearchTerm(''); fetchTutors(''); }} className="font-bold underline ml-4">
              Clear Search
            </button>
          </div>
        )}

        {/* Tutor Grid */}
        {loading ? (
          <div className="text-center py-20 text-xs font-bold text-gray-400">Loading available tutors...</div>
        ) : tutors.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-gray-200 p-8 space-y-3">
            <h3 className="text-sm font-black text-[#0F172A]">No Tutors Available Yet</h3>
            <p className="text-xs text-gray-500">Be the first parent to post a job requirement and let tutors apply directly!</p>
            <Link href="/parent/dashboard/post-job" className="inline-block mt-2 px-6 py-3 bg-[#0F172A] text-white font-bold text-xs rounded-xl">
              Post a Tuition Job ➔
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tutors.map((tutor) => {
              // Check if tutor is new (created within last 30 days)
              const isNew = new Date(tutor.created_at).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000

              return (
                <div key={tutor.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 flex flex-col justify-between space-y-4 hover:shadow-md transition-all">
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5">
                        <h3 className="text-sm font-black text-[#0F172A]">{tutor.full_name || 'Verified Tutor'}</h3>
                        <p className="text-[11px] text-gray-400">{tutor.city || 'Available Online & On-site'}</p>
                      </div>
                      {isNew && (
                        <span className="px-2.5 py-1 bg-green-50 text-green-700 text-[10px] font-black rounded-lg border border-green-200">
                          New Talent ⭐
                        </span>
                      )}
                    </div>

                    <div className="p-3 bg-[#F8FAFC] rounded-2xl space-y-1">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expertise / Subjects</span>
                      <p className="text-xs font-bold text-[#334155]">{tutor.subjects || tutor.headline || 'General Tutoring & Academic Coaching'}</p>
                    </div>

                    <p className="text-xs text-gray-500 line-clamp-2">{tutor.bio || 'Dedicated educator focused on building strong conceptual foundations and student confidence.'}</p>
                  </div>

                  <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-gray-400 block">Expected Fee</span>
                      <span className="text-xs font-black text-[#0F172A]">{tutor.hourly_rate ? `Rs. ${tutor.hourly_rate}/hr` : 'Negotiable'}</span>
                    </div>

                    <Link
                      href={`/parent/browse/${tutor.id}`}
                      className="px-4 py-2.5 bg-[#0F172A] hover:bg-gray-800 text-white font-bold text-xs rounded-xl transition-all shadow-sm"
                    >
                      View Profile ➔
                    </Link>
                  </div>

                </div>
              )
            })}
          </div>
        )}

      </div>
    </main>
  )
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-500">Loading directory...</div>}>
      <BrowseContent />
    </Suspense>
  )
}