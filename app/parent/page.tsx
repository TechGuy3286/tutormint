'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function PostJobPage() {
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [area, setArea] = useState('')
  const [budget, setBudget] = useState('')
  const [timings, setTimings] = useState('')
  
  const [postedJobId, setPostedJobId] = useState<string | null>(null)
  const [matchingTutors, setMatchingTutors] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const handlePostJob = (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    // Simulate unique job ID generation and matching algorithm with free-slot tutors
    setTimeout(() => {
      const generatedId = `JOB-TM-${Math.floor(1000 + Math.random() * 9000)}`
      setPostedJobId(generatedId)
      
      // Sample matching tutors found with free slots for this timing
      setMatchingTutors([
        {
          id: 'TM-8821',
          name: 'Sir Bilal Ahmed',
          matchScore: '98% Match (Free Slot Available)',
          rate: 'Rs. 25,000 / month',
          status: 'Pending Response'
        },
        {
          id: 'TM-7342',
          name: 'Sir Zeeshan Haider',
          matchScore: '92% Match (Free Slot Available)',
          rate: 'Rs. 30,000 / month',
          status: 'Pending Response'
        }
      ])
      setLoading(false)
    }, 1000)
  }

  const handleSendDemoRequest = (tutorId: string) => {
    alert(`Demo class request sent to Tutor ${tutorId} under Job ID ${postedJobId}. The tutor must Accept or Reject within the response window.`)
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Post a Tuition Job Ad</h1>
            <p className="text-sm text-gray-500 mt-1">
              Publish your requirement. Our system will generate a unique tracking ID and match you with tutors having free hourly slots.
            </p>
          </div>
          <Link href="/browse/tutors" className="text-xs font-bold text-emerald-600 uppercase tracking-wider hover:underline">
            ← Back to Browse
          </Link>
        </div>

        {!postedJobId ? (
          /* Job Posting Form */
          <form onSubmit={handlePostJob} className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Subject(s) Required</label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. O-Level Mathematics & Chemistry"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Student Grade / Class</label>
                <input
                  type="text"
                  required
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  placeholder="e.g. Grade 9 / Matric / O-Level"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Area / Location (Lahore)</label>
                <input
                  type="text"
                  required
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. DHA Phase 5"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Monthly Budget (PKR)</label>
                <input
                  type="text"
                  required
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="e.g. 20,000 - 25,000"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Preferred Timings</label>
              <input
                type="text"
                required
                value={timings}
                onChange={(e) => setTimings(e.target.value)}
                placeholder="e.g. Monday to Friday, 05:00 PM - 07:00 PM"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs tracking-widest uppercase rounded-xl shadow-lg transition-all duration-200 disabled:opacity-50"
            >
              {loading ? 'Publishing & Matching Tutors...' : 'Publish Job & Generate Tracking ID'}
            </button>
          </form>
        ) : (
          /* Job Posted Success & Matching Tutors View */
          <div className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-2xl text-center space-y-2">
              <span className="text-xs font-bold text-emerald-800 uppercase tracking-widest">Job Successfully Published</span>
              <h2 className="text-2xl font-black text-slate-900 font-mono">{postedJobId}</h2>
              <p className="text-xs text-slate-600">
                This transaction ID is now sticky to your job listing and upcoming chats. Below are the verified tutors matching your free slots.
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Suggested Matching Tutors (Free Slots)</h3>
              
              <div className="space-y-3">
                {matchingTutors.map((tutor) => (
                  <div key={tutor.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400">{tutor.id}</span>
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded">
                          {tutor.matchScore}
                        </span>
                      </div>
                      <h4 className="text-base font-bold text-slate-900 mt-1">{tutor.name}</h4>
                      <p className="text-xs text-slate-600">{tutor.rate}</p>
                    </div>

                    <button
                      onClick={() => handleSendDemoRequest(tutor.id)}
                      className="px-5 py-2.5 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs tracking-wider uppercase rounded-xl shadow transition-all"
                    >
                      Send Demo Class Request
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}