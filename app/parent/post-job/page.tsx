'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function PostJobPage() {
  const router = useRouter()
  const supabase = createClient()

  // Filter & Form States
  const [selectedCity, setSelectedCity] = useState('Lahore')
  const [selectedArea, setSelectedArea] = useState('Gulberg')
  const [selectedGrade, setSelectedGrade] = useState('Grade 9 & 10 - Arts')
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(['General Subjects'])
  const [tuitionTime, setTuitionTime] = useState('05:00 PM')
  const [preferredGender, setPreferredGender] = useState('No Preference')

  // AI Generated Job & Matched Tutors State
  const [generatedJob, setGeneratedJob] = useState<{ title: string; description: string; requirements: string } | null>(null)
  const [matchedTutors, setMatchedTutors] = useState<any[]>([])
  const [loadingAi, setLoadingAi] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [loginModal, setLoginModal] = useState(false)

  // Restore saved session data on page load (e.g. after returning from login)
  useEffect(() => {
    const savedSession = sessionStorage.getItem('savedJobSession')
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession)
        if (parsed.filters) {
          setSelectedCity(parsed.filters.city || 'Lahore')
          setSelectedArea(parsed.filters.area || 'Gulberg')
          setSelectedGrade(parsed.filters.grade || 'Grade 9 & 10 - Arts')
          setSelectedSubjects(parsed.filters.subjects || ['General Subjects'])
          setTuitionTime(parsed.filters.tuitionTime || '05:00 PM')
          setPreferredGender(parsed.filters.preferredGender || 'No Preference')
        }
        if (parsed.generatedJob) {
          setGeneratedJob(parsed.generatedJob)
        }
        if (parsed.matchedTutors) {
          setMatchedTutors(parsed.matchedTutors)
        }
        // Clear session storage once restored
        sessionStorage.removeItem('savedJobSession')
      } catch (err) {
        console.error("Error restoring session:", err)
      }
    }
  }, [])

  const handleGenerateAiJob = () => {
    setLoadingAi(true)
    setTimeout(() => {
      const jobData = {
        title: `Required Expert Tutor for ${selectedGrade} - ${selectedSubjects.join(', ')}`,
        description: `Looking for an experienced and camera-verified home tutor in ${selectedArea}, ${selectedCity}. Sessions required around ${tuitionTime}. Focus on conceptual clarity, past papers, and structured study plans.`,
        requirements: `${selectedSubjects.join(', ')}, ${selectedGrade} Expertise, Communication Skills`
      }
      const tutorsList = [
        { id: 't-1', name: 'Ayesha Khan', title: `Expert in Mathematics (${selectedGrade})`, gender: 'Female', location: `${selectedArea}, ${selectedCity}`, rate: '2,500 PKR / hr', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150' },
        { id: 't-2', name: 'Muhammad Ali', title: `Expert in Physics (${selectedGrade})`, gender: 'Male', location: `${selectedArea}, ${selectedCity}`, rate: '3,000 PKR / hr', image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150' }
      ]

      setGeneratedJob(jobData)
      setMatchedTutors(tutorsList)
      setLoadingAi(false)
    }, 700)
  }

  const handlePublishJob = async () => {
    setPublishing(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        // Save current filters and generated job preview to session storage before redirecting to login
        const sessionPayload = {
          filters: { city: selectedCity, area: selectedArea, grade: selectedGrade, subjects: selectedSubjects, tuitionTime, preferredGender },
          generatedJob,
          matchedTutors
        }
        sessionStorage.setItem('savedJobSession', JSON.stringify(sessionPayload))
        setLoginModal(true)
        setPublishing(false)
        return
      }

      // If logged in, publish job to database
      const res = await fetch('/api/parent/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: generatedJob?.title,
          description: generatedJob?.description,
          subject: selectedSubjects[0],
          grade: selectedGrade,
          location: `${selectedArea}, ${selectedCity}`,
          budget: 'Custom Quote'
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to publish job')

      alert('✅ Job successfully published and matched with verified tutors!')
      router.push('/parent/dashboard')
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8 text-[#334155]">
      
      {loginModal && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs font-bold shadow-sm flex items-center justify-between">
          <span>🔒 Please login or register as a parent to publish your job. Your filters and AI-generated job preview are safely saved!</span>
          <div className="flex gap-2">
            <button 
              onClick={() => router.push('/parent/login')}
              className="px-4 py-2 bg-[#0F172A] text-white rounded-xl text-xs"
            >
              Login Now ➔
            </button>
            <button onClick={() => setLoginModal(false)} className="px-2 text-gray-500">✕</button>
          </div>
        </div>
      )}

      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex justify-between items-center">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-[#0F172A]">Post Personalized Job Requirement</h1>
          <p className="text-xs text-gray-500">Configure academic taxonomy and schedule filters below. Our AI will instantly draft your listing and match top educators.</p>
        </div>
      </div>

      {/* SECTION 1: FILTERS */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
        <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 border-b border-gray-100 pb-3">
          Section 1: Academic Taxonomy & Preferences
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-[#0F172A]">City</label>
            <select 
              value={selectedCity} 
              onChange={(e) => setSelectedCity(e.target.value)}
              className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none"
            >
              <option value="Lahore">Lahore</option>
              <option value="Karachi">Karachi</option>
              <option value="Islamabad">Islamabad</option>
              <option value="Multan">Multan</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[#0F172A]">Area / Neighborhood</label>
            <input 
              type="text" 
              value={selectedArea} 
              onChange={(e) => setSelectedArea(e.target.value)}
              placeholder="e.g. Gulberg, DHA"
              className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[#0F172A]">Grade / Specialization</label>
            <input 
              type="text" 
              value={selectedGrade} 
              onChange={(e) => setSelectedGrade(e.target.value)}
              placeholder="e.g. Grade 9 & 10 - Arts"
              className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[#0F172A]">Target Subject</label>
            <input 
              type="text" 
              value={selectedSubjects[0]} 
              onChange={(e) => setSelectedSubjects([e.target.value])}
              placeholder="e.g. Mathematics, Physics"
              className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={handleGenerateAiJob}
            disabled={loadingAi}
            className="px-6 py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {loadingAi ? 'Generating AI Job & Matching Tutors...' : '✨ Generate AI Job Post & Find Tutors'}
          </button>
        </div>
      </div>

      {/* SECTION 2: AI-GENERATED JOB PREVIEW & MATCHED TUTORS */}
      {generatedJob && (
        <div className="space-y-6 animate-in fade-in duration-300">
          
          <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-3xl space-y-4 shadow-sm">
            <div className="flex justify-between items-center border-b border-emerald-200 pb-3">
              <span className="text-xs font-black text-emerald-900 uppercase tracking-widest">🤖 AI-Generated Job Post Preview</span>
              <button
                type="button"
                onClick={handlePublishJob}
                disabled={publishing}
                className="px-6 py-3 bg-[#059669] hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : 'Publish Job Requirement ➔'}
              </button>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-black text-[#0F172A]">{generatedJob.title}</h3>
              <p className="text-xs text-[#334155] leading-relaxed"><strong>DESCRIPTION:</strong> {generatedJob.description}</p>
              <p className="text-xs text-[#334155]"><strong>REQUIRED SKILLS:</strong> {generatedJob.requirements}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-black text-[#0F172A] uppercase tracking-wider">Instant AI-Matched Tutors ({matchedTutors.length})</h2>
            <div className="space-y-3">
              {matchedTutors.map((tutor) => (
                <div key={tutor.id} className="bg-white p-5 rounded-2xl border border-gray-200 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-4">
                    <img src={tutor.image} alt={tutor.name} className="w-12 h-12 rounded-xl object-cover border" />
                    <div>
                      <h4 className="text-xs font-black text-[#0F172A]">{tutor.name}</h4>
                      <p className="text-[11px] font-bold text-[#059669]">{tutor.title} • {tutor.rate}</p>
                      <p className="text-[10px] text-gray-500">📍 {tutor.location}</p>
                    </div>
                  </div>
                  <button 
                    onClick={handlePublishJob}
                    className="px-4 py-2.5 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl shadow-sm"
                  >
                    Hire / Contact ➔
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

    </main>
  )
}