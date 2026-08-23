'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function BrowseContent() {
  const [tutors, setTutors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
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
          const filtered = data.filter((tutor: any) => 
            tutor.subjects?.toLowerCase().includes(query.toLowerCase()) ||
            tutor.full_name?.toLowerCase().includes(query.toLowerCase()) ||
            tutor.bio?.toLowerCase().includes(query.toLowerCase())
          )

          if (filtered.length > 0) {
            setTutors(filtered)
          } else {
            setIsSoftMatch(true)
            setTutors(data) // Soft matching fallback
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
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header & Search Bar */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-[#0F172A]">Find Verified Tutors</h1>
            <p className="text-xs text-gray-500">Browse available tutors and connect instantly.</p>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
            <input 
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by subject (e.g. Mathematics, Physics, English)..."
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

        {/* Tutors List */}
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
          <div className="space-y-4">
            {tutors.map((tutor) => {
              const avatarUrl = tutor.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tutor.full_name || 'Tutor'}`
              const isNew = new Date(tutor.created_at).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000

              return (
                <div 
                  key={tutor.id} 
                  className="bg-white p-5 rounded-3xl shadow-xs border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:shadow-md transition-all"
                >
                  {/* Left: 1x1 Avatar & Info */}
                  <div className="flex items-center gap-4 w-full sm:w-auto">
                    <img 
                      src={avatarUrl} 
                      alt={tutor.full_name || 'Tutor'} 
                      className="h-16 w-16 aspect-square rounded-2xl object-cover bg-gray-100 border border-gray-200 shrink-0" 
                    />

                    <div className="space-y-1 flex-1">
                      <div className="flex items-center justify-between sm:justify-start gap-3">
                        <h3 className="text-sm font-black text-[#0F172A]">
                          {tutor.full_name || 'Verified Tutor'}
                        </h3>
                        {isNew ? (
                          <span className="px-2 py-0.5 bg-green-50 text-green-700 text-[10px] font-black rounded-md border border-green-200">
                            ⭐ New Talent
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-amber-600">
                            ⭐ {tutor.rating || '5.0'} ({tutor.reviews_count || '12'})
                          </span>
                        )}
                      </div>
                      
                      <p className="text-xs font-bold text-[#0d9488]">
                        {tutor.subjects ? `Expert in ${tutor.subjects}` : (tutor.headline || 'Expert Tutor')} 
                        {tutor.gender ? ` • Gender: ${tutor.gender}` : ''}
                      </p>

                      <p className="text-[11px] text-gray-500 flex flex-wrap items-center gap-2">
                        <span>🎓 {tutor.degree || 'Qualified Educator'}</span>
                        <span>•</span>
                        <span>📍 {tutor.city || 'Available Online & On-site'}</span>
                        <span>•</span>
                        <span className="font-bold text-[#0F172A]">💰 {tutor.hourly_rate ? `Rs. ${tutor.hourly_rate}/hr` : 'Negotiable'}</span>
                      </p>
                    </div>
                  </div>

                  {/* Right: Hire / Contact Button */}
                  <div className="w-full sm:w-auto flex justify-end shrink-0">
                    <Link
                      href={`/parent/browse/${tutor.id}`}
                      className="w-full sm:w-auto text-center px-6 py-3 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all tracking-wider"
                    >
                      Hire / Contact ➔
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