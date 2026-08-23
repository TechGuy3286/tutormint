'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function PostJobPage() {
  const router = useRouter()
  const supabase = createClient()

  const [formData, setFormData] = useState({
    title: '',
    subject: '',
    grade: '',
    location: '',
    budget: '',
    description: ''
  })
  const [loading, setLoading] = useState(false)
  const [createdJob, setCreatedJob] = useState<any>(null)
  const [matchedTutors, setMatchedTutors] = useState<any[]>([])
  const [loginPrompt, setLoginPrompt] = useState(false)

  // On load, check if there was pending job data saved before login
  useEffect(() => {
    const savedData = sessionStorage.getItem('pendingJobForm')
    if (savedData) {
      try {
        setFormData(JSON.parse(savedData))
        sessionStorage.removeItem('pendingJobForm')
      } catch (e) {
        console.error(e)
      }
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setLoginPrompt(false)

    try {
      // Check if user is logged in
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        // Save form state to sessionStorage so it's preserved after login
        sessionStorage.setItem('pendingJobForm', JSON.stringify(formData))
        setLoginPrompt(true)
        setLoading(false)
        return
      }

      // If logged in, proceed with publishing
      const res = await fetch('/api/parent/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setCreatedJob(data.job)
      setMatchedTutors([
        { id: 'tutor-1', full_name: 'Ayesha Khan', title: 'Expert in Mathematics', hourly_rate: '2500 PKR' },
        { id: 'tutor-2', full_name: 'Muhammad Ali', title: 'FSc Physics Specialist', hourly_rate: '3000 PKR' }
      ])
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  const sendDemoRequest = async (tutorId: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      sessionStorage.setItem('pendingJobForm', JSON.stringify(formData))
      router.push('/parent/login')
      return
    }

    const res = await fetch('/api/tutor/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobTxId: createdJob?.job_tx_id || 'JOB-PENDING',
        tutorId,
        type: 'demo_request'
      })
    })
    if (res.ok) {
      alert(`Demo request sent successfully!`)
      router.push(`/parent/dashboard`)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8 bg-white rounded-2xl shadow-sm border border-gray-200 my-10">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Post a Tuition Job</h1>
        <p className="text-xs text-gray-500">Configure your requirements, explore AI-matched tutors, and publish instantly.</p>
      </div>

      {loginPrompt && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs font-bold shadow-sm flex items-center justify-between">
          <span>🔒 Please login or register to publish your job requirement. Your filter selections and form data have been safely saved!</span>
          <div className="flex gap-2">
            <button 
              onClick={() => router.push('/parent/login')} 
              className="px-4 py-2 bg-[#0F172A] text-white rounded-xl text-xs"
            >
              Login Now ➔
            </button>
          </div>
        </div>
      )}

      {!createdJob ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Job Title</label>
            <input
              type="text"
              required
              placeholder="e.g., O-Level Math Home Tutor Needed in DHA"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Subject</label>
              <input
                type="text"
                required
                placeholder="e.g., Mathematics"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Grade / Level</label>
              <input
                type="text"
                required
                placeholder="e.g., Class 10 / O-Levels"
                value={formData.grade}
                onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Location (City / Area)</label>
              <input
                type="text"
                required
                placeholder="e.g., Gulberg, Lahore"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Budget / Fees</label>
              <input
                type="text"
                required
                placeholder="e.g., 25,000 PKR / mo"
                value={formData.budget}
                onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Detailed Description</label>
            <textarea
              rows={4}
              required
              placeholder="Specify timings, specific learning goals, etc."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs tracking-widest uppercase rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? 'Checking Authentication...' : 'Publish Job Requirement ➔'}
          </button>
        </form>
      ) : (
        <div className="space-y-6">
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 space-y-1">
            <p className="font-bold text-sm">Job Successfully Published!</p>
            <p className="text-xs font-mono">Transaction ID: {createdJob.job_tx_id}</p>
          </div>

          <h2 className="text-lg font-bold text-slate-900">Recommended Tutors with Free Slots</h2>
          <div className="space-y-4">
            {matchedTutors.map((tutor) => (
              <div key={tutor.id} className="p-4 border border-gray-200 rounded-xl flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">{tutor.full_name}</h3>
                  <p className="text-xs text-gray-500">{tutor.title} • {tutor.hourly_rate}</p>
                </div>
                <button
                  onClick={() => sendDemoRequest(tutor.id)}
                  className="px-4 py-2 bg-slate-900 hover:bg-emerald-600 text-white text-xs font-bold uppercase rounded-lg transition-all"
                >
                  Send Demo Class Request
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}