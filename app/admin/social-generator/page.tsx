'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SocialGeneratorPage() {
  const [tutors, setTutors] = useState<any[]>([])
  const [selectedTutor, setSelectedTutor] = useState<any>(null)
  const [copied, setCopied] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    fetchVerifiedTutors()
  }, [])

  const fetchVerifiedTutors = async () => {
    const { data } = await supabase
      .from('tutors')
      .select('*')
      .eq('is_verified', true)
    
    if (data && data.length > 0) {
      setTutors(data)
      setSelectedTutor(data[0])
    }
  }

  const postContent = selectedTutor ? `
🎓 Verified Expert Tutor Spotlight | TutorMint Pakistan

👤 Name: ${selectedTutor.full_name}
⭐ Title: ${selectedTutor.title}
📝 About: ${selectedTutor.bio || 'Verified camera-inspected professional educator ready to help students succeed.'}

🔗 View Profile & Hire Directly (Zero Commission): 
https://tutormint.org/tutor/${selectedTutor.user_id}

#TutorMint #VerifiedTutors #HomeTutorsLahore #OnlineTutorsPakistan #Education #PeerToPeerLearning
  `.trim() : ''

  const handleCopy = () => {
    navigator.clipboard.writeText(postContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 my-10">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Admin Social Media Post Generator</h1>
        <p className="text-xs text-gray-500">Auto-generate brand-themed promotional spotlights for verified tutors.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Selector Panel */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
          <label className="block text-xs font-bold text-slate-700 uppercase">Select Verified Tutor</label>
          <select
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
            onChange={(e) => {
              const found = tutors.find(t => t.user_id === e.target.value)
              setSelectedTutor(found)
            }}
            value={selectedTutor?.user_id || ''}
          >
            {tutors.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.full_name} — {t.title}
              </option>
            ))}
          </select>

          {selectedTutor && (
            <div className="p-4 bg-gray-50 rounded-xl space-y-2 text-xs">
              <p><strong>Internal Tracker ID:</strong> {selectedTutor.internal_id || 'TX-GEN-9941'}</p>
              <p><strong>Status:</strong> 100% Verified & Active</p>
            </div>
          )}
        </div>

        {/* Brand Theme Preview Card */}
        <div className="bg-slate-900 text-white p-8 rounded-3xl shadow-xl flex flex-col justify-between space-y-6 relative overflow-hidden border border-emerald-500/30">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl"></div>

          <div className="space-y-3 z-10">
            <span className="px-3 py-1 bg-emerald-500 text-slate-900 text-[10px] font-bold rounded-full uppercase tracking-wider">
              TutorMint Verified Spotlight
            </span>
            <h2 className="text-2xl font-black">{selectedTutor?.full_name || 'Select a Tutor'}</h2>
            <p className="text-xs text-emerald-400 font-semibold">{selectedTutor?.title}</p>
            <p className="text-xs text-slate-300 line-clamp-3">
              {selectedTutor?.bio || 'Connect directly with verified home and online educators. Zero middlemen. Zero commission.'}
            </p>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-between items-center z-10 text-[11px] font-mono text-gray-400">
            <span>tutormint.org</span>
            <span className="text-emerald-400">100% Verified Profile</span>
          </div>
        </div>
      </div>

      {/* Copy & Share Action Box */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
        <h3 className="text-xs font-bold text-slate-700 uppercase">Generated Social Media Post Copy & Hashtags</h3>
        <textarea
          readOnly
          rows={7}
          value={postContent}
          className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-slate-800 outline-none"
        />
        <button
          onClick={handleCopy}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md"
        >
          {copied ? '✓ Copied Post & Details to Clipboard!' : 'Copy Social Media Post Package'}
        </button>
      </div>
    </div>
  )
}