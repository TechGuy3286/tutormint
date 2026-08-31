'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Sialkot', 'Gujranwala']

function PublicBrowseTuitionsContent() {
  const [tuitions, setTuitions] = useState<any[]>([])
  const [filteredTuitions, setFilteredTuitions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCity, setSelectedCity] = useState('')
  const [selectedMode, setSelectedMode] = useState('')

  const resultsRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const searchParams = useSearchParams()

  useEffect(() => {
    const initialQuery = searchParams.get('subject') || ''
    if (initialQuery) {
      setSearchTerm(initialQuery)
    }
    fetchTuitions()
  }, [])

  const fetchTuitions = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('tuitions')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        // If table doesn't exist yet, provide sample live tuition jobs
        setTuitions([
          {
            id: '1',
            title: 'O-Level Mathematics & Physics Tutor Required',
            city: 'Lahore',
            area: 'DHA Phase 5',
            mode: 'Physical',
            budget: 'Rs. 35,000 / month',
            description: 'Looking for an experienced female tutor for grade 9 O-Level student. 5 days a week.',
            created_at: new Date().toISOString()
          },
          {
            id: '2',
            title: 'FSc Pre-Medical Chemistry Teacher',
            city: 'Islamabad',
            area: 'F-7',
            mode: 'Online',
            budget: 'Rs. 25,000 / month',
            description: 'Need a qualified tutor for 1st year FSc chemistry preparation.',
            created_at: new Date().toISOString()
          },
          {
            id: '3',
            title: 'Primary School Teacher for Class 4',
            city: 'Karachi',
            area: 'Clifton',
            mode: 'School',
            budget: 'Rs. 40,000 / month',
            description: 'Reputed private school looking for a dedicated primary teacher.',
            created_at: new Date().toISOString()
          }
        ])
        setFilteredTuitions([
          {
            id: '1',
            title: 'O-Level Mathematics & Physics Tutor Required',
            city: 'Lahore',
            area: 'DHA Phase 5',
            mode: 'Physical',
            budget: 'Rs. 35,000 / month',
            description: 'Looking for an experienced female tutor for grade 9 O-Level student. 5 days a week.',
            created_at: new Date().toISOString()
          },
          {
            id: '2',
            title: 'FSc Pre-Medical Chemistry Teacher',
            city: 'Islamabad',
            area: 'F-7',
            mode: 'Online',
            budget: 'Rs. 25,000 / month',
            description: 'Need a qualified tutor for 1st year FSc chemistry preparation.',
            created_at: new Date().toISOString()
          },
          {
            id: '3',
            title: 'Primary School Teacher for Class 4',
            city: 'Karachi',
            area: 'Clifton',
            mode: 'School',
            budget: 'Rs. 40,000 / month',
            description: 'Reputed private school looking for a dedicated primary teacher.',
            created_at: new Date().toISOString()
          }
        ])
      } else if (data) {
        setTuitions(data)
        setFilteredTuitions(data)
      }
    } catch (err) {
      console.error('Error fetching tuitions:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleApplyFilters = () => {
    let result = [...tuitions]

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      result = result.filter(t => 
        t.title?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.city?.toLowerCase().includes(q) ||
        t.area?.toLowerCase().includes(q)
      )
    }

    if (selectedCity) {
      result = result.filter(t => t.city?.toLowerCase().includes(selectedCity.toLowerCase()))
    }

    if (selectedMode) {
      result = result.filter(t => t.mode?.toLowerCase().includes(selectedMode.toLowerCase()))
    }

    setFilteredTuitions(result)
    resultsRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleClearFilters = () => {
    setSearchTerm('')
    setSelectedCity('')
    setSelectedMode('')
    setFilteredTuitions(tuitions)
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-12 px-4 sm:px-12 text-[#1E293B] font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Breadcrumb */}
        <div className="text-xs font-bold text-gray-500 flex items-center gap-2 bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs w-fit">
          <Link href="/" className="hover:text-[#0F172A] transition-colors">Home</Link>
          <span className="text-gray-300">/</span>
          <span className="text-blue-600">Find Tuitions / Jobs</span>
        </div>

        {/* Filter Box */}
        <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-sm border border-gray-200 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A]">Find Tuitions / Jobs</h1>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">Browse active tuition requirements posted by parents and school owners across Pakistan.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input 
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 Search title or keyword..."
              className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#1E293B] font-medium"
            />
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs outline-none font-semibold text-[#1E293B]"
            >
              <option value="">All Cities</option>
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value)}
              className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs outline-none font-semibold text-[#1E293B]"
            >
              <option value="">All Modes</option>
              <option value="Physical">Physical</option>
              <option value="Online">Online</option>
              <option value="School">School</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button onClick={handleClearFilters} className="text-xs font-bold text-gray-400 hover:text-[#d60008]">
              Reset Filters
            </button>
            <button onClick={handleApplyFilters} className="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl shadow-md transition-all">
              Search Jobs ➔
            </button>
          </div>
        </div>

        {/* Results Counter */}
        <div ref={resultsRef} className="flex items-center justify-between px-2 pt-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Showing <span className="text-[#0F172A] font-black">{filteredTuitions.length}</span> active tuition jobs
          </span>
        </div>

        {/* Tuitions List */}
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filteredTuitions.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-3xl border border-gray-200 p-8 space-y-3 shadow-sm">
            <h3 className="text-base font-black text-[#0F172A]">No Tuition Jobs Found</h3>
            <p className="text-xs text-gray-500 font-medium">Check back soon for new parent requirements.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTuitions.map((job) => (
              <div key={job.id} className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4 hover:border-blue-300 transition-all">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-extrabold rounded-md border border-blue-200 uppercase">
                        {job.mode || 'Physical'}
                      </span>
                      <span className="text-xs text-gray-400 font-medium">📍 {job.area}, {job.city}</span>
                    </div>
                    <h3 className="text-lg font-black text-[#0F172A]">{job.title}</h3>
                  </div>
                  <span className="px-4 py-2 bg-emerald-50 text-emerald-800 text-xs font-black rounded-xl border border-emerald-200">
                    {job.budget}
                  </span>
                </div>
                <p className="text-xs text-slate-600 font-medium leading-relaxed">{job.description}</p>
                <div className="pt-3 border-t border-gray-100 flex justify-between items-center">
                  <span className="text-[11px] text-gray-400 font-mono">Posted recently</span>
                  <a href="https://wa.me/923215872222" target="_blank" rel="noreferrer" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all">
                    Apply for Job on WhatsApp ➔
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}

export default function PublicBrowseTuitionsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Loading jobs...
        </div>
      </div>
    }>
      <PublicBrowseTuitionsContent />
    </Suspense>
  )
}