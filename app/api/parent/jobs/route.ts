import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized parent session' }, { status: 401 })
    }

    const body = await request.json()
    const { title, subject, grade, location, budget, description } = body

    // Generate a unique internal job tracking/transaction ID
    const jobTxId = `JOB-TX-${Math.random().toString(36).substring(2, 9).toUpperCase()}`

    // Insert job into database
    const { data: jobData, error: jobError } = await supabase
      .from('parent_jobs')
      .insert({
        job_tx_id: jobTxId,
        parent_user_id: user.id,
        title,
        subject,
        grade,
        location,
        budget,
        description,
        status: 'active'
      })
      .select()
      .single()

    if (jobError) throw jobError

    return NextResponse.json({ success: true, jobTxId, job: jobData })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
```[cite: 2]

---

### Step 2: Build the Smart Match & Demo Request Component (`app/parent/dashboard/post-job/page.tsx`)
Replace or update your post-job interface so that upon submission, it displays the matching available tutors and allows the parent to dispatch a demo class request bound to that transaction ID.

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PostJobPage() {
  const router = useRouter()
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/parent/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setCreatedJob(data.job)
      // Mock or fetch matching free-slot tutors based on subject/grade
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
    const res = await fetch('/api/tutor/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobTxId: createdJob.job_tx_id,
        tutorId,
        type: 'demo_request'
      })
    })
    if (res.ok) {
      alert(`Demo request sent successfully! Transaction ID: ${createdJob.job_tx_id}`)
      router.push(`/chat/${createdJob.job_tx_id}`)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8 bg-white rounded-2xl shadow-sm border border-gray-200 my-10">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Post a Tuition Job</h1>
        <p className="text-xs text-gray-500">Zero middlemen. Connect directly with qualified, verified educators.</p>
      </div>

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
            {loading ? 'Publishing Job & Finding Matches...' : 'Publish Job Ad & Match Tutors'}
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
```[cite: 2]