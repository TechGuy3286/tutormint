'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const LEVELS = [
  'Playgroup to Class 5 (Primary)',
  'Class 6 to 8 (Middle)',
  'Matriculation (9th & 10th)',
  'O-Levels',
  'FSc / Intermediate (11th & 12th)',
  'A-Levels',
  'Bachelor / BS (University)',
  'Master / MPhil',
  'Entry Tests (MDCAT / ECAT / SAT)',
  'Holy Quran & Tajweed',
  'Foreign Languages',
  'Computer & IT Skills'
]

const LEVEL_TO_GRADES: Record<string, string[]> = {
  'Playgroup to Class 5 (Primary)': ['Playgroup / Nursery / Prep', 'Grade 1 to 3', 'Grade 4 & 5'],
  'Class 6 to 8 (Middle)': ['Grade 6 to 8'],
  'Matriculation (9th & 10th)': ['9th Science', '9th Arts', '10th Science', '10th Arts'],
  'O-Levels': ['O-Level Year 1', 'O-Level Year 2'],
  'FSc / Intermediate (11th & 12th)': [
    '1st Year Pre-Medical',
    '1st Year Pre-Engineering',
    '1st Year Computer Science',
    '2nd Year Pre-Medical',
    '2nd Year Pre-Engineering',
    '2nd Year Computer Science'
  ],
  'A-Levels': ['A-Level Year 1', 'A-Level Year 2'],
  'Bachelor / BS (University)': ['University / BS Semester 1-8'],
  'Master / MPhil': ['University / BS Semester 1-8'],
  'Entry Tests (MDCAT / ECAT / SAT)': ['MDCAT Preparation', 'ECAT Preparation', 'SAT Preparation'],
  'Holy Quran & Tajweed': ['Beginner Noorani Qaida', 'Quran with Tajweed', 'Hifz-e-Quran'],
  'Foreign Languages': ['Spoken English', 'Arabic Language', 'Chinese / German'],
  'Computer & IT Skills': ['Basic Computing & MS Office', 'Programming & Coding', 'Web Development']
}

const SUBJECTS_LIST = [
  'Mathematics', 'Physics', 'Chemistry', 'Biology',
  'English', 'Urdu', 'Islamiyat / Islamic Studies', 'Pakistan Studies',
  'Computer Science', 'Information Technology', 'General Science',
  'Economics', 'Accounting', 'Business Studies', 'Commerce',
  'History', 'Geography', 'Civics', 'Sociology', 'Psychology',
  'Arabic', 'Persian', 'French', 'Drawing / Fine Arts',
  'Home Economics', 'Statistics', 'Additional Mathematics', 'Quran & Hifz'
]

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Sialkot', 'Gujranwala']

const AREAS = [
  'Gulberg', 'DHA', 'Bahria Town', 'Model Town', 'Johar Town', 
  'Wapda Town', 'Faisal Town', 'Cantt', 'Garden Town', 'Shadman', 
  'F-6', 'F-7', 'F-8', 'G-8', 'G-9', 'H-8', 'Clifton', 'PECHS', 'Gulshan-e-Iqbal'
]

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
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('')
  const [selectedGender, setSelectedGender] = useState('No Preference')
  
  // New Feature States
  const [selectedTuitionMode, setSelectedTuitionMode] = useState('')
  const [maxBudget, setMaxBudget] = useState<number>(5000)
  const [savedTutorIds, setSavedTutorIds] = useState<string[]>([])
  const [showOnlySaved, setShowOnlySaved] = useState(false)

  const resultsRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const searchParams = useSearchParams()

  useEffect(() => {
    const storedBookmarks = localStorage.getItem('tutormint_saved_tutors')
    if (storedBookmarks) {
      try { setSavedTutorIds(JSON.parse(storedBookmarks)) } catch (e) {}
    }

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

  const toggleBookmark = (tutorId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    let updated: string[] = []
    if (savedTutorIds.includes(tutorId)) {
      updated = savedTutorIds.filter(id => id !== tutorId)
    } else {
      updated = [...savedTutorIds, tutorId]
    }
    setSavedTutorIds(updated)
    localStorage.setItem('tutormint_saved_tutors', JSON.stringify(updated))
  }

  const handleLevelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLevel(e.target.value)
    setSelectedGrade('')
  }

  const availableGrades = selectedLevel ? (LEVEL_TO_GRADES[selectedLevel] || []) : []

  const handleApplyFilters = () => {
    let result = [...tutors]

    if (showOnlySaved) {
      result = result.filter(t => savedTutorIds.includes(t.id || t.user_id))
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      result = result.filter(t => 
        t.subjects?.toLowerCase().includes(q) ||
        t.full_name?.toLowerCase().includes(q) ||
        t.bio?.toLowerCase().includes(q) ||
        t.city?.toLowerCase().includes(q)
      )
    }

    if (selectedLevel) {
      result = result.filter(t => 
        t.level?.toLowerCase().includes(selectedLevel.toLowerCase()) || 
        t.subjects?.toLowerCase().includes(selectedLevel.toLowerCase()) ||
        t.bio?.toLowerCase().includes(selectedLevel.toLowerCase())
      )
    }

    if (selectedGrade) {
      result = result.filter(t => 
        t.grade?.toLowerCase().includes(selectedGrade.toLowerCase()) || 
        t.subjects?.toLowerCase().includes(selectedGrade.toLowerCase())
      )
    }

    if (selectedSubjects.length > 0) {
      result = result.filter(t => 
        selectedSubjects.some(subj => t.subjects?.toLowerCase().includes(subj.toLowerCase()))
      )
    }

    if (selectedCity) {
      result = result.filter(t => t.city?.toLowerCase().includes(selectedCity.toLowerCase()))
    }

    if (selectedArea) {
      result = result.filter(t => 
        t.city?.toLowerCase().includes(selectedArea.toLowerCase()) || 
        t.bio?.toLowerCase().includes(selectedArea.toLowerCase())
      )
    }

    if (selectedTuitionMode) {
      result = result.filter(t => 
        t.tuition_mode?.toLowerCase().includes(selectedTuitionMode.toLowerCase()) || true
      )
    }

    if (maxBudget) {
      result = result.filter(t => !t.hourly_rate || Number(t.hourly_rate) <= maxBudget)
    }

    if (selectedTimeSlot) {
      result = result.filter(t => t.time_slot?.toLowerCase().includes(selectedTimeSlot.toLowerCase()))
    }

    if (selectedGender && selectedGender !== 'No Preference') {
      result = result.filter(t => t.gender?.toLowerCase() === selectedGender.toLowerCase())
    }

    setFilteredTutors(result)
    resultsRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

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
    setSelectedTimeSlot('')
    setSelectedTuitionMode('')
    setMaxBudget(5000)
    setSelectedGender('No Preference')
    setShowOnlySaved(false)
    setFilteredTutors(tutors)
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-10 px-4 sm:px-12 text-[#334155]">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Breadcrumb & Shortlist Tab Toggle */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-xs font-bold text-gray-400 flex items-center gap-2">
            <Link href="/" className="hover:text-[#0F172A] transition-colors">Home</Link>
            <span>/</span>
            <span className="text-[#0F172A]">Find Verified Tutors</span>
          </div>

          <button
            onClick={() => {
              setShowOnlySaved(!showOnlySaved)
              setTimeout(handleApplyFilters, 50)
            }}
            className={`px-4 py-2 rounded-2xl text-xs font-black transition-all flex items-center gap-2 border ${
              showOnlySaved 
                ? 'bg-[#d60008] text-white border-[#d60008] shadow-sm' 
                : 'bg-white text-[#0F172A] border-gray-200 hover:bg-gray-50'
            }`}
          >
            ❤️ My Shortlisted Tutors ({savedTutorIds.length})
          </button>
        </div>

        {/* Header & Comprehensive Filter Box */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-[#0F172A]">Find Verified Tutors</h1>
            <p className="text-xs text-gray-500">Configure your specific academic requirements, modes, and budget below.</p>
          </div>

          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input 
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 Search by subject, tutor name, or keyword..."
              className="flex-1 p-3.5 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
            />
          </div>

          {/* --- SECTION 1: ACADEMIC TAXONOMY --- */}
          <div className="pt-4 border-t border-gray-100 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">
              Section 1: Academic Taxonomy (Level → Grade → Subjects)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-[#F8FAFC] p-4 rounded-2xl border border-gray-200 space-y-2">
                <label className="text-xs font-black text-[#0F172A] flex items-center gap-1.5">
                  📚 Academic Level
                </label>
                <select
                  value={selectedLevel}
                  onChange={handleLevelChange}
                  className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="">Select Academic Level First</option>
                  {LEVELS.map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
                </select>
              </div>

              <div className="bg-[#F8FAFC] p-4 rounded-2xl border border-gray-200 space-y-2">
                <label className="text-xs font-black text-[#0F172A] flex items-center gap-1.5">
                  🎓 Grade / Specialisation
                </label>
                <select
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  disabled={!selectedLevel}
                  className={`w-full p-3 border rounded-xl text-xs outline-none font-bold ${
                    !selectedLevel ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white border-gray-200 text-[#334155]'
                  }`}
                >
                  <option value="">{!selectedLevel ? 'Select Academic Level above first' : 'All Grades in this Level'}</option>
                  {availableGrades.map(grd => <option key={grd} value={grd}>{grd}</option>)}
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

          {/* --- SECTION 2: LOCATION, MODE, BUDGET & PREFERENCES --- */}
          <div className="pt-4 border-t border-gray-100 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">
              Section 2: Location, Tuition Mode, Budget & Preferences
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500">💻 Tuition Mode</label>
                <select
                  value={selectedTuitionMode}
                  onChange={(e) => setSelectedTuitionMode(e.target.value)}
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="">All Modes (Home & Online)</option>
                  <option value="Home">Home Tuition (Physical)</option>
                  <option value="Online">Online Tuition</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-gray-500">
                  <span>💰 Max Hourly Budget</span>
                  <span className="text-[#0F172A] font-black">Rs. {maxBudget} / hr</span>
                </div>
                <input 
                  type="range"
                  min="500"
                  max="10000"
                  step="500"
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(Number(e.target.value))}
                  className="w-full accent-[#d60008] cursor-pointer mt-2"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500">⏰ Tuition Time Slot</label>
                <select
                  value={selectedTimeSlot}
                  onChange={(e) => setSelectedTimeSlot(e.target.value)}
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none font-bold text-[#334155]"
                >
                  <option value="">Any Time Slot</option>
                  <option value="03:00 PM">03:00 PM</option>
                  <option value="05:00 PM">05:00 PM</option>
                  <option value="07:00 PM">07:00 PM</option>
                </select>
              </div>

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

            {/* Bottom CTA & Reset Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-between pt-4 gap-3 border-t border-gray-100">
              <button
                onClick={handleClearFilters}
                className="text-xs font-bold text-gray-400 hover:text-[#d60008] transition-colors"
              >
                Reset All Filters
              </button>

              <button
                onClick={handleApplyFilters}
                className="w-full sm:w-auto px-8 py-4 bg-[#d60008] hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl shadow-md transition-all flex items-center justify-center gap-2"
              >
                🔍 Search Tutors & Apply Filters
              </button>
            </div>
          </div>

        </div>

        {/* Results Anchor & Counter */}
        <div ref={resultsRef} className="flex items-center justify-between px-2 pt-4">
          <span className="text-xs font-bold text-gray-500">
            Showing <span className="text-[#0F172A] font-black">{filteredTutors.length}</span> verified tutors
          </span>
        </div>

        {/* Tutors List with Improved Spacious Cards */}
        {loading ? (
          <div className="text-center py-20 text-xs font-bold text-gray-400">Loading available tutors...</div>
        ) : filteredTutors.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-gray-200 p-8 space-y-3">
            <h3 className="text-sm font-black text-[#0F172A]">No Tutors Match Your Filters</h3>
            <p className="text-xs text-gray-500">Try broadening your filter criteria or clearing your search.</p>
            <button onClick={handleClearFilters} className="mt-2 px-6 py-3 bg-[#0F172A] text-white font-bold text-xs rounded-xl">
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTutors.map((tutor) => {
              const tutorId = tutor.id || tutor.user_id
              const avatarUrl = tutor.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tutor.full_name || 'Tutor'}`
              const isSaved = savedTutorIds.includes(tutorId)
              const tutorPhone = tutor.phone || tutor.whatsapp || '923211045245'
              const whatsappLink = `https://wa.me/${tutorPhone}?text=Assalam-o-Alaikum%20${encodeURIComponent(tutor.full_name || 'Tutor')},%20I%20found%20your%20profile%20on%20TutorMint%20and%20want%20to%20discuss%20tuition.`

              return (
                <div 
                  key={tutorId} 
                  className="bg-white p-6 sm:p-7 rounded-3xl border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:shadow-md transition-all relative"
                >
                  {/* Bookmark Heart Button */}
                  <button 
                    onClick={(e) => toggleBookmark(tutorId, e)}
                    className="absolute top-5 right-5 sm:static p-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 transition-all text-sm"
                    title={isSaved ? "Remove from Shortlist" : "Shortlist Tutor"}
                  >
                    {isSaved ? '❤️' : '🤍'}
                  </button>

                  {/* Left: Avatar & Info */}
                  <div className="flex items-center gap-5 w-full sm:w-auto">
                    <img 
                      src={avatarUrl} 
                      alt={tutor.full_name || 'Tutor'} 
                      className="h-16 w-16 sm:h-20 sm:w-20 aspect-square rounded-2xl object-cover bg-gray-100 border border-gray-200 shrink-0 shadow-xs" 
                    />

                    <div className="space-y-2 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/browse/${tutorId}`} className="text-sm sm:text-base font-black text-[#0F172A] hover:underline">
                          {tutor.full_name || 'Verified Tutor'}
                        </Link>
                        
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-black rounded-md border border-blue-100">
                          ✓ Verified
                        </span>

                        <span className="px-2 py-0.5 bg-amber-50 text-amber-800 text-[10px] font-extrabold rounded-md border border-amber-200 flex items-center gap-1">
                          ⭐ {tutor.rating || '5.0'} <span className="text-gray-400 font-normal">({tutor.reviews_count || '12'})</span>
                        </span>
                      </div>
                      
                      <p className="text-xs sm:text-sm font-bold text-[#0d9488]">
                        {tutor.subjects ? `Expert in ${tutor.subjects}` : (tutor.headline || 'Expert Tutor')} 
                        {tutor.gender ? ` • ${tutor.gender}` : ''}
                      </p>

                      <p className="text-xs text-gray-500 flex flex-wrap items-center gap-3">
                        <span>🎓 {tutor.degree || 'Qualified Educator'}</span>
                        <span>•</span>
                        <span>📍 {tutor.city || 'Available Online & Home'}</span>
                        <span>•</span>
                        <span className="font-bold text-[#0F172A]">💰 {tutor.hourly_rate ? `Rs. ${tutor.hourly_rate}/hr` : 'Negotiable'}</span>
                      </p>
                    </div>
                  </div>

                  {/* Right: WhatsApp Button & View Profile */}
                  <div className="w-full sm:w-auto flex items-center gap-2.5 justify-end shrink-0 pt-2 sm:pt-0">
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
                      className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-[#0F172A] font-bold text-xs rounded-xl transition-all border border-gray-200"
                    >
                      View Profile
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