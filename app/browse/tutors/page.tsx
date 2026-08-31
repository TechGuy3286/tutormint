'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import TutorCard from '@/components/TutorCard'
import { fetchLevels, fetchGradesForLevel, fetchSubjectsForGrade } from '@/lib/taxonomy'

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Sialkot', 'Gujranwala']

const CITY_TO_AREAS: Record<string, string[]> = {
  'Lahore': ['Gulberg', 'DHA', 'Bahria Town', 'Model Town', 'Johar Town', 'Wapda Town', 'Faisal Town', 'Cantt', 'Garden Town', 'Shadman'],
  'Islamabad': ['F-6', 'F-7', 'F-8', 'G-8', 'G-9', 'H-8', 'Blue Area', 'I-8'],
  'Karachi': ['Clifton', 'PECHS', 'Gulshan-e-Iqbal', 'Defence', 'North Nazimabad', 'Korangi'],
  'Rawalpindi': ['Saddar', 'Satellite Town', 'Bahria Town Rawalpindi', 'Chaklala'],
  'Faisalabad': ["People's Colony", 'D-Ground', 'Madina Town', 'Sargodha Road'],
  'Multan': ['Gulgasht Colony', 'Bosan Road', 'Shah Rukn-e-Alam', 'Mumtazabad'],
  'Peshawar': ['University Town', 'Hayatabad', 'Saddar', 'Dabgari Gardens'],
  'Quetta': ['Jinnah Town', 'Model Town', 'Shahbaz Town', 'Satellite Town'],
  'Sialkot': ['Model Town', 'Paris Road', 'Cantt', 'Defence Road'],
  'Gujranwala': ['Model Town', 'Peoples Colony', 'Satellite Town', 'Civil Lines']
}

function PublicBrowseTutorsContent() {
  const [tutors, setTutors] = useState<any[]>([])
  const [filteredTutors, setFilteredTutors] = useState<any[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [searchTerm, setSearchTerm] = useState<string>('')

  const [levelsList, setLevelsList] = useState<string[]>([])
  const [gradesList, setGradesList] = useState<string[]>([])
  const [subjectsList, setSubjectsList] = useState<string[]>([])

  const [levelSearch, setLevelSearch] = useState<string>('')
  const [gradeSearch, setGradeSearch] = useState<string>('')
  const [subjectSearch, setSubjectSearch] = useState<string>('')

  const [selectedLevel, setSelectedLevel] = useState<string>('')
  const [selectedGrade, setSelectedGrade] = useState<string>('')
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [selectedCity, setSelectedCity] = useState<string>('')
  const [selectedArea, setSelectedArea] = useState<string>('')
  const [selectedTuitionMode, setSelectedTuitionMode] = useState<string>('')
  const [maxMonthlyBudget, setMaxMonthlyBudget] = useState<number>(150000)
  const [selectedSession, setSelectedSession] = useState<string>('')
  const [selectedGender, setSelectedGender] = useState<string>('No Preference')

  const [savedTutorIds, setSavedTutorIds] = useState<string[]>([])

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
    loadTaxonomyLevels()
    fetchTutors()
  }, [])

  const toggleBookmark = (tutorId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const updated = savedTutorIds.includes(tutorId)
      ? savedTutorIds.filter(id => id !== tutorId)
      : [...savedTutorIds, tutorId]
    setSavedTutorIds(updated)
    localStorage.setItem('tutormint_saved_tutors', JSON.stringify(updated))
  }

  const loadTaxonomyLevels = async () => {
    const lvls = await fetchLevels()
    setLevelsList(lvls)
  }

  useEffect(() => {
    if (!selectedLevel) {
      setGradesList([])
      setSelectedGrade('')
      setSubjectsList([])
      return
    }
    async function loadGrades() {
      const grades = await fetchGradesForLevel(selectedLevel)
      setGradesList(grades)
      setSelectedGrade('')
      setSubjectsList([])
    }
    loadGrades()
  }, [selectedLevel])

  useEffect(() => {
    if (!selectedLevel || !selectedGrade) {
      setSubjectsList([])
      return
    }
    async function loadSubs() {
      const subs = await fetchSubjectsForGrade(selectedLevel, selectedGrade)
      setSubjectsList(subs)
    }
    loadSubs()
  }, [selectedLevel, selectedGrade])

  const fetchTutors = async () => {
    setLoading(true)
    try {
      const [profilesRes, tutorsRes] = await Promise.all([
        supabase.from('tutor_profiles').select('*'),
        supabase.from('tutors').select('*')
      ])

      const combinedMap = new Map()
      const processRecord = (record: any) => {
        const id = record.id || record.user_id || record.tutor_id
        if (!id) return
        const existing = combinedMap.get(id) || {}
        combinedMap.set(id, { ...existing, ...record })
      }

      const profiles = profilesRes.data || []
      profiles.forEach(processRecord)

      const tutorsList = tutorsRes.data || []
      tutorsList.forEach(processRecord)

      const finalTutors = Array.from(combinedMap.values())
      setTutors(finalTutors)
      setFilteredTutors(finalTutors)
    } catch (err) {
      console.error('Error fetching tutors:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let result = [...tutors]

    if (searchTerm.trim()) {
      const tokens = searchTerm.toLowerCase().split(/\s+/).filter(t => t.length > 0)

      result = result.filter(t => {
        const textBlob = Object.values(t || {})
          .map(val => {
            if (Array.isArray(val)) return val.join(' ')
            if (val && typeof val === 'object') return JSON.stringify(val)
            return String(val || '')
          })
          .join(' ')
          .toLowerCase()
        
        if (tokens.length > 0) {
          return tokens.every(token => textBlob.includes(token))
        }
        return textBlob.includes(searchTerm.toLowerCase())
      })
    }

    if (selectedLevel) {
      result = result.filter(t => {
        const blob = Object.values(t || {}).join(' ').toLowerCase()
        return blob.includes(selectedLevel.toLowerCase())
      })
    }

    if (selectedGrade) {
      result = result.filter(t => {
        const blob = Object.values(t || {}).join(' ').toLowerCase()
        return blob.includes(selectedGrade.toLowerCase())
      })
    }

    if (selectedSubjects.length > 0) {
      result = result.filter(t => {
        const blob = Object.values(t || {}).join(' ').toLowerCase()
        return selectedSubjects.some(subj => blob.includes(subj.toLowerCase()))
      })
    }

    if (selectedCity) {
      result = result.filter(t => {
        const blob = Object.values(t || {}).join(' ').toLowerCase()
        return blob.includes(selectedCity.toLowerCase())
      })
    }

    if (selectedArea) {
      result = result.filter(t => {
        const blob = Object.values(t || {}).join(' ').toLowerCase()
        return blob.includes(selectedArea.toLowerCase())
      })
    }

    if (selectedTuitionMode) {
      result = result.filter(t => {
        const blob = Object.values(t || {}).join(' ').toLowerCase()
        return blob.includes(selectedTuitionMode.toLowerCase())
      })
    }

    if (maxMonthlyBudget) {
      result = result.filter(t => !t.monthly_rate || Number(t.monthly_rate) <= maxMonthlyBudget)
    }

    if (selectedSession) {
      result = result.filter(t => {
        const blob = Object.values(t || {}).join(' ').toLowerCase()
        return blob.includes(selectedSession.toLowerCase())
      })
    }

    if (selectedGender && selectedGender !== 'No Preference') {
      result = result.filter(t => {
        const blob = Object.values(t || {}).join(' ').toLowerCase()
        return blob.includes(selectedGender.toLowerCase())
      })
    }

    setFilteredTutors(result)
  }, [searchTerm, selectedLevel, selectedGrade, selectedSubjects, selectedCity, selectedArea, selectedTuitionMode, maxMonthlyBudget, selectedSession, selectedGender, tutors])

  const handleClearFilters = () => {
    setSearchTerm('')
    setSelectedLevel('')
    setSelectedGrade('')
    setSelectedSubjects([])
    setSelectedCity('')
    setSelectedArea('')
    setSelectedTuitionMode('')
    setMaxMonthlyBudget(150000)
    setSelectedSession('')
    setSelectedGender('No Preference')
    setFilteredTutors(tutors)
  }

  const filteredLevels = levelsList.filter(l => l.toLowerCase().includes(levelSearch.toLowerCase()))
  const filteredGrades = gradesList.filter(g => g.toLowerCase().includes(gradeSearch.toLowerCase()))
  const filteredSubjects = subjectsList.filter(s => s.toLowerCase().includes(subjectSearch.toLowerCase()))
  const availableAreas = selectedCity ? (CITY_TO_AREAS[selectedCity] || []) : []

  return (
    <main className="min-h-screen bg-[#F8FAFC] pt-[5px] pb-12 px-4 sm:px-12 text-[#1E293B] font-sans">
      <div className="max-w-5xl mx-auto space-y-4">
        
        {/* Filter Box */}
        <div className="bg-white p-5 sm:p-6 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Find Tutors / Teachers</h1>
            <button
              onClick={fetchTutors}
              className="text-xs font-bold text-[#059669] hover:underline flex items-center gap-1 cursor-pointer"
            >
              🔄 Refresh Tutors
            </button>
          </div>

          {/* Prominent Search Bar */}
          <div className="flex flex-col sm:flex-row gap-2">
            <input 
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 Search by subject (e.g. Physics), tutor name, specialty, or location..."
              className="flex-1 p-4 bg-amber-50/70 hover:bg-amber-50 focus:bg-white border-2 border-amber-400 focus:border-[#0F172A] rounded-2xl text-xs outline-none text-[#1E293B] font-bold transition-all shadow-md"
            />
          </div>

          {/* Full Collapsible Filters List */}
          <div className="space-y-1.5 pt-2">
            
            {/* Filter 1: Academic Level */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>📚 Academic Level {selectedLevel && <span className="text-[#059669]">({selectedLevel})</span>}</span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1 space-y-2">
                <input 
                  type="text"
                  placeholder="Search levels..."
                  value={levelSearch}
                  onChange={(e) => setLevelSearch(e.target.value)}
                  className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none text-[#1E293B]"
                />
                <select
                  value={selectedLevel}
                  onChange={(e) => {
                    setSelectedLevel(e.target.value)
                    setSelectedGrade('')
                  }}
                  className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-xs outline-none font-semibold text-[#1E293B]"
                  size={4}
                >
                  <option value="">All Levels</option>
                  {filteredLevels.map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
                </select>
              </div>
            </details>

            {/* Filter 2: Grade */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>🎓 Grade {selectedGrade && <span className="text-[#059669]">({selectedGrade})</span>}</span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1 space-y-2">
                <input 
                  type="text"
                  placeholder="Search grades..."
                  value={gradeSearch}
                  onChange={(e) => setGradeSearch(e.target.value)}
                  className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none text-[#1E293B]"
                />
                <select
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  disabled={!selectedLevel}
                  className={`w-full p-2.5 border rounded-lg text-xs outline-none font-semibold ${
                    !selectedLevel ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white border-gray-200 text-[#1E293B]'
                  }`}
                  size={4}
                >
                  <option value="">{!selectedLevel ? 'Select Academic Level first' : 'All Grades'}</option>
                  {filteredGrades.map(grd => <option key={grd} value={grd}>{grd}</option>)}
                </select>
              </div>
            </details>

            {/* Filter 3: Subjects */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>📖 Subjects {selectedSubjects.length > 0 && <span className="text-[#059669]">({selectedSubjects.length} selected)</span>}</span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1 space-y-2">
                <input 
                  type="text"
                  placeholder="Search subjects..."
                  value={subjectSearch}
                  onChange={(e) => setSubjectSearch(e.target.value)}
                  className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none text-[#1E293B]"
                />
                {subjectsList.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic p-2">Select an Academic Level & Grade above to view subjects.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-44 overflow-y-auto pr-2 bg-white p-2.5 rounded-lg border border-gray-200">
                    {filteredSubjects.map(sub => (
                      <label key={sub} className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer p-1 hover:bg-slate-50 rounded transition-colors">
                        <input 
                          type="checkbox"
                          checked={selectedSubjects.includes(sub)}
                          onChange={() => {
                            if (selectedSubjects.includes(sub)) {
                              setSelectedSubjects(selectedSubjects.filter(s => s !== sub))
                            } else {
                              setSelectedSubjects([...selectedSubjects, sub])
                            }
                          }}
                          className="rounded border-gray-300 text-[#d60008] focus:ring-0 w-3.5 h-3.5"
                        />
                        <span className="truncate">{sub}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </details>

            {/* Filter 4: City */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>📍 City {selectedCity && <span className="text-[#059669]">({selectedCity})</span>}</span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1">
                <select
                  value={selectedCity}
                  onChange={(e) => {
                    setSelectedCity(e.target.value)
                    setSelectedArea('')
                  }}
                  className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-xs outline-none font-semibold text-[#1E293B]"
                >
                  <option value="">All Cities</option>
                  {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </details>

            {/* Filter 5: Area */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>🏙️ Area {selectedArea && <span className="text-[#059669]">({selectedArea})</span>}</span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1">
                <select
                  value={selectedArea}
                  onChange={(e) => setSelectedArea(e.target.value)}
                  disabled={!selectedCity}
                  className={`w-full p-2.5 border rounded-lg text-xs outline-none font-semibold ${
                    !selectedCity ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white border-gray-200 text-[#1E293B]'
                  }`}
                >
                  <option value="">{!selectedCity ? 'Select City first' : 'All Areas in City'}</option>
                  {availableAreas.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </details>

            {/* Filter 6: Mode */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>💻 Mode {selectedTuitionMode && <span className="text-[#059669]">({selectedTuitionMode})</span>}</span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1">
                <select
                  value={selectedTuitionMode}
                  onChange={(e) => setSelectedTuitionMode(e.target.value)}
                  className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-xs outline-none font-semibold text-[#1E293B]"
                >
                  <option value="">All Modes</option>
                  <option value="Physical">Physical</option>
                  <option value="Online">Online</option>
                  <option value="School">School</option>
                </select>
              </div>
            </details>

            {/* Filter 7: Monthly Budget */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>💰 Monthly Budget <span className="text-[#059669]">(Up to Rs. {maxMonthlyBudget.toLocaleString()})</span></span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1 bg-white p-3 rounded-lg border border-gray-200 space-y-2">
                <input 
                  type="range"
                  min="5000"
                  max="150000"
                  step="5000"
                  value={maxMonthlyBudget}
                  onChange={(e) => setMaxMonthlyBudget(Number(e.target.value))}
                  className="w-full accent-[#d60008] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-gray-500 font-mono">
                  <span>Rs. 5,000</span>
                  <span>Rs. 75,000</span>
                  <span>Rs. 150,000+</span>
                </div>
              </div>
            </details>

            {/* Filter 8: Timing / Session */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>⏰ Timing / Session {selectedSession && <span className="text-[#059669]">({selectedSession})</span>}</span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1">
                <select
                  value={selectedSession}
                  onChange={(e) => setSelectedSession(e.target.value)}
                  className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-xs outline-none font-semibold text-[#1E293B]"
                >
                  <option value="">Any Timing</option>
                  <option value="School">School</option>
                  <option value="Morning">Morning</option>
                  <option value="Afternoon">Afternoon</option>
                  <option value="Evening">Evening</option>
                </select>
              </div>
            </details>

            {/* Filter 9: Gender */}
            <details className="bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-[#0F172A] cursor-pointer">
              <summary className="outline-none flex justify-between items-center">
                <span>👤 Gender {selectedGender !== 'No Preference' && <span className="text-[#059669]">({selectedGender})</span>}</span>
                <span className="text-gray-400 font-normal">▼</span>
              </summary>
              <div className="pt-3 pb-1">
                <select
                  value={selectedGender}
                  onChange={(e) => setSelectedGender(e.target.value)}
                  className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-xs outline-none font-semibold text-[#1E293B]"
                >
                  <option value="No Preference">No Preference</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
            </details>

          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <button
              onClick={handleClearFilters}
              className="text-xs font-bold text-gray-400 hover:text-[#d60008] transition-colors cursor-pointer"
            >
              Reset All Filters
            </button>

            <button
              onClick={() => {
                resultsRef.current?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="px-6 py-3 bg-[#d60008] hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              🔍 Apply Filters & Search
            </button>
          </div>

        </div>

        {/* Results Counter */}
        <div ref={resultsRef} className="flex items-center justify-between px-2 pt-1">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Showing <span className="text-[#0F172A] font-black">{filteredTutors.length}</span> verified tutors
          </span>
        </div>

        {/* Tutors List */}
        {loading ? (
          <div className="flex justify-center items-center py-16">
            <div className="w-8 h-8 border-3 border-[#059669] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filteredTutors.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-3xl border border-gray-200 p-8 space-y-3 shadow-sm">
            <h3 className="text-base font-black text-[#0F172A]">No Tutors Match Your Filters</h3>
            <p className="text-xs text-gray-500 font-medium">Try broadening your filter criteria or clearing your search.</p>
            <button onClick={handleClearFilters} className="mt-2 px-5 py-2.5 bg-[#0F172A] hover:bg-[#059669] text-white font-bold text-xs rounded-xl transition-all cursor-pointer">
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTutors.map((tutor) => {
              const tutorId = String(tutor.id || tutor.user_id || '')
              const isSaved = savedTutorIds.includes(tutorId)

              return (
                <TutorCard
                  key={tutorId}
                  tutor={tutor}
                  isSaved={isSaved}
                  onToggleBookmark={toggleBookmark}
                />
              )
            })}
          </div>
        )}

      </div>
    </main>
  )
}

export default function PublicBrowseTutorsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Loading directory...
        </div>
      </div>
    }>
      <PublicBrowseTutorsContent />
    </Suspense>
  )
}