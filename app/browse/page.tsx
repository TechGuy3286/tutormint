'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const SUBJECTS_LIST = [
  'English', 'Urdu', 'Mathematics', 'Islamiyat / Islamic Studies',
  'Pakistan Studies', 'General Science', 'Economics', 'Civics',
  'Education', 'History', 'Geography', 'Arabic',
  'Persian', 'Punjabi', 'Home Economics', 'Fine Arts',
  'Drawing', 'Computer Science', 'Information Technology', 'Physical Education',
  'Health & Physical Education', 'Additional Mathematics'
]

const LEVELS = ['Matriculation / O-Levels', 'FSc / A-Levels', 'ADP (2 Years)', 'BS (4 Years)', 'Holy Quran', 'IB', 'IGCSE']
const GRADES = ['Grade 9 & 10 - Science', 'Grade 9 & 10 - Arts', 'First Year (11th)', 'Second Year (12th)', 'O-Level Year 1', 'O-Level Year 2']
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad']
const AREAS = ['Gulberg', 'DHA', 'Bahria Town', 'Model Town', 'Johar Town', 'Clifton']

function PublicBrowseContent() {
  const [tutors, setTutors] = useState<any[]>([])
  const [filteredTutors, setFilteredTutors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  // Filter states
  const [selectedLevel, setSelectedLevel] = useState('')
  const [selectedGrade, setSelectedGrade] = useState('')
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [selectedCity, setSelectedCity] = useState('')
  const [selectedArea, setSelectedArea] = useState('')
  const [selectedGender, setSelectedGender] = useState('No Preference')

  const supabase = createClient()
  const searchParams = useSearchParams()

  useEffect(() => {
    const initialQuery = searchParams.get('subject') || ''
    if (initialQuery) {
      setSearchTerm(initialQuery)
    }
    fetchTutors()
  }, [])

  const fetchTutors = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('tutors')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      if (data) {
        setTutors(data)
        setFilteredTutors(data)
      }
    } catch (err) {
      console.error('Error fetching tutors:', err)
    } finally {
      setLoading(false)
    }
  }

  // Apply filters dynamically whenever filter states or search term change
  useEffect(() => {
    let result = [...tutors]

    // Search term filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      result = result.filter(t => 
        t.subjects?.toLowerCase().includes(q) ||
        t.full_name?.toLowerCase().includes(q) ||
        t.bio?.toLowerCase().includes(q) ||
        t.city?.toLowerCase().includes(q)
      )
    }

    // Level filter
    if (selectedLevel) {
      result = result.filter(t => t.level?.toLowerCase() === selectedLevel.toLowerCase() || t.subjects?.toLowerCase().includes(selectedLevel.toLowerCase()))
    }

    // Grade filter
    if (selectedGrade) {
      result = result.filter(t => t.grade?.toLowerCase().includes(selectedGrade.toLowerCase()) || t.subjects?.toLowerCase().includes(selectedGrade.toLowerCase()))
    }

    // Subjects filter (if any selected)
    if (selectedSubjects.length > 0) {
      result = result.filter(t => 
        selectedSubjects.some(subj => t.subjects?.toLowerCase().includes(subj.toLowerCase()))
      )
    }

    // City filter
    if (selectedCity) {
      result = result.filter(t => t.city?.toLowerCase().includes(selectedCity.toLowerCase()))
    }

    // Area filter
    if (selectedArea) {
      result = result.filter(t => t.city?.toLowerCase().includes(selectedArea.toLowerCase()) || t.bio?.toLowerCase().includes(selectedArea.toLowerCase()))
    }

    // Gender filter
    if (selectedGender && selectedGender !== 'No Preference') {
      result = result.filter(t => t.gender?.toLowerCase() === selectedGender.toLowerCase())
    }

    setFilteredTutors(result)
  }, [searchTerm, selectedLevel, selectedGrade, selectedSubjects, selectedCity, selectedArea, selectedGender, tutors])

  const toggleSubject = (subject: string) => {
    if (selectedSubjects.includes(subject)) {
      setSelectedSubjects(selectedSubjects.filter(s => s !== subject))
    } else {
      setSelectedSubjects([...selectedSubjects, subject])
    }
  }

  const handleClearFilters = () => {
    setSearchTerm('')
    setSelectedLevel('')
    setSelectedGrade('')
    setSelectedSubjects([])
    setSelectedCity('')
    setSelectedArea('')
    setSelectedGender('No Preference')
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-10 px-4 sm:px-12 text-[#334155]">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Breadcrumb Navigation */}
        <div className="text-xs font-bold text-gray-400 flex items-center gap-2">
          <Link href="/" className="hover:text-[#0F172A] transition-colors">Home</Link>
          <span>/</span>
          <span className="text-[#0F172A]">Find Verified Tutors</span>
        </div>

        {/* Header & AI Search Bar */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-[#0F172A]">Find Verified Tutors</h1>
            <p className="text-xs text-gray-500">Search by subject, level, or keyword to connect with top educators instantly.</p>
          </div>

          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input 
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 AI Search: e.g. Mathematics, O-Level Physics, English..."
              className="flex-1 p-3.5 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="px-4 py-3.5 bg-gray-100 hover:bg-gray-200 text-[#0F172A] font-bold text-xs rounded-2xl transition-all"
              >
                Clear Search
              </button>
            )}
          </div>

          {/* --- SECTION 1: ACADEMIC TAXONOMY --- */}
          <div className="pt-4 border-t border-gray-100 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">
              Section 1: Academic Taxonomy (Level → Grade → Subjects)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Level Filter */}
              <div className="bg-[#F8FAFC] p-4 rounded-2xl border border-gray-200 space-y-2">
                <label className="text-xs font-black text-[#0F172A] flex items-center gap-1.5">
                  📚 Level (Searchable)
                </label>
                <select
                  value={selectedLevel}
                  onChange={(e) => setSelectedLevel(e.target.value)}
                  className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="">All Academic Levels</option>
                  {LEVELS.map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
                </select>
              </div>

              {/* Grade Filter */}
              <div className="bg-[#F8FAFC] p-4 rounded-2xl border border-gray-200 space-y-2">
                <label className="text-xs font-black text-[#0F172A] flex items-center gap-1.5">
                  🎓 Grade / Specialisation
                </label>
                <select
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="">All Grades / Specialisations</option>
                  {GRADES.map(grd => <option key={grd} value={grd}>{grd}</option>)}
                </select>
              </div>
            </div>

            {/* Select Subjects Checkbox Grid */}
            <div className="bg-[#F8FAFC] p-5 rounded-2xl border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-[#0F172A] flex items-center gap-1.5">
                  📖 Select Subjects ({selectedSubjects.length} selected)
                </label>
                {selectedSubjects.length > 0 && (
                  <button onClick={() => setSelectedSubjects([])} className="text-[11px] font-bold text-[#d60008] hover:underline">
                    Clear Subjects
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-48 overflow-y-auto pr-2">
                {SUBJECTS_LIST.map(sub => (
                  <label key={sub} className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer p-1.5 hover:bg-white rounded-lg transition-colors">
                    <input 
                      type="checkbox"
                      checked={selectedSubjects.includes(sub)}
                      onChange={() => toggleSubject(sub)}
                      className="rounded border-gray-300 text-[#d60008] focus:ring-0"
                    />
                    <span className="truncate">{sub}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* --- SECTION 2: LOCATION, TIME & PREFERENCES --- */}
          <div className="pt-4 border-t border-gray-100 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">
              Section 2: Location, Time & Preferences
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {/* City */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500">📍 City</label>
                <select
                  value={selectedCity}
                  onChange={(e) => setSelectedCity(e.target.value)}
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="">All Cities</option>
                  {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Area */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500">🏙️ Area / Location</label>
                <select
                  value={selectedArea}
                  onChange={(e) => setSelectedArea(e.target.value)}
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="">All Areas</option>
                  {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* Tuition Time */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500">⏰ Tuition Time Slot</label>
                <select
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="">Any Time Slot</option>
                  <option value="03:00 PM">03:00 PM</option>
                  <option value="05:00 PM">05:00 PM</option>
                  <option value="07:00 PM">07:00 PM</option>
                </select>
              </div>

              {/* Preferred Gender */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500">👤 Preferred Gender</label>
                <select
                  value={selectedGender}
                  onChange={(e) => setSelectedGender(e.target.value)}
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="No Preference">No Preference</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleClearFilters}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-[#d60008] transition-colors"
              >
                Reset All Filters
              </button>
            </div>
          </div>

        </div>

        {/* Results Counter */}
        <div className="flex items-center justify-between px-2">
          <span className="text-xs font-bold text-gray-500">
            Showing <span className="text-[#0F172A] font-black">{filteredTutors.length}</span> verified tutors
          </span>
        </div>

        {/* Tutors List */}
        {loading ? (
          <div className="text-center py-20 text-xs font-bold text-gray-400">Loading available tutors...</div>
        ) : filteredTutors.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-gray-200 p-8 space-y-3">
            <h3 className="text-sm font-black text-[#0F172A]">No Tutors Match Your Filters</h3>
            <p className="text-xs text-gray-500">Try loosening your filter criteria or clearing your search.</p>
            <button onClick={handleClearFilters} className="mt-2 px-6 py-3 bg-[#0F172A] text-white font-bold text-xs rounded-xl">
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTutors.map((tutor) => {
              const tutorId = tutor.id || tutor.user_id
              const avatarUrl = tutor.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tutor.full_name || 'Tutor'}`
              const isNew = new Date(tutor.created_at || Date.now()).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000

              return (
                <div 
                  key={tutorId} 
                  className="bg-white p-5 rounded-3xl border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:shadow-md transition-all"
                >
                  {/* Left: Avatar & Info */}
                  <div className="flex items-center gap-4 w-full sm:w-auto">
                    <img 
                      src={avatarUrl} 
                      alt={tutor.full_name || 'Tutor'} 
                      className="h-14 w-14 aspect-square rounded-2xl object-cover bg-gray-100 border border-gray-200 shrink-0" 
                    />

                    <div className="space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/browse/${tutorId}`} className="text-sm font-black text-[#0F172A] hover:underline">
                          {tutor.full_name || 'Verified Tutor'}
                        </Link>
                        
                        {isNew ? (
                          <span className="px-2 py-0.5 bg-green-50 text-green-700 text-[10px] font-black rounded-md border border-green-200">
                            ⭐ New Talent
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-black rounded-md border border-blue-100">
                            ✓ Verified Tutor
                          </span>
                        )}

                        <span className="px-2 py-0.5 bg-amber-50 text-amber-800 text-[10px] font-extrabold rounded-md border border-amber-200 flex items-center gap-1">
                          ⭐ {tutor.rating || '5.0'} <span className="text-gray-400 font-normal">({tutor.reviews_count || '12'})</span>
                        </span>
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

                  {/* Right: Dual Buttons */}
                  <div className="w-full sm:w-auto flex items-center gap-2 justify-end shrink-0">
                    <Link
                      href={`/browse/${tutorId}`}
                      className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-[#0F172A] font-bold text-xs rounded-xl transition-all border border-gray-200"
                    >
                      View Profile
                    </Link>
                    <Link
                      href={`/browse/${tutorId}`}
                      className="px-5 py-2.5 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all tracking-wider"
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

export default function PublicBrowsePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-500">Loading directory...</div>}>
      <PublicBrowseContent />
    </Suspense>
  )
}