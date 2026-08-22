'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function CompleteProfilePage() {
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState({
    fullName: '',
    cnic: '',
    phone: '',
    whatsapp: '',
    city: '',
    area: '',
    subject: '',
    grade: '',
    title: '',
    bio: '',
    hourlyRate: '',
    selfieUploaded: false,
    disclaimerAccepted: false
  })
  const [loading, setLoading] = useState(false)
  const [completionPercent, setCompletionPercent] = useState(25)
  const [assignedInternalId, setAssignedInternalId] = useState<string | null>(null)
  
  const router = useRouter()
  const supabase = createClient()

  // Calculate dynamic completion percentage based on fields filled
  useEffect(() => {
    let score = 25 // Base identity
    if (formData.city && formData.area) score += 25
    if (formData.title && formData.subject && formData.bio) score += 25
    if (formData.selfieUploaded && formData.disclaimerAccepted) score += 25
    setCompletionPercent(score)
  }, [formData])

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.disclaimerAccepted) {
      alert('You must accept the marketing & promotional disclaimer to proceed.')
      return
    }

    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Generate unique random internal tracking ID upon 100% completion
      const internalId = `TUTOR-TRK-${Math.random().toString(36).substring(2, 9).toUpperCase()}`
      setAssignedInternalId(internalId)

      const { error } = await supabase
        .from('tutors')
        .upsert({
          user_id: user.id,
          full_name: formData.fullName,
          cnic: formData.cnic,
          phone: formData.phone,
          whatsapp: formData.whatsapp,
          city: formData.city,
          area: formData.area,
          subject: formData.subject,
          grade: formData.grade,
          title: formData.title,
          bio: formData.bio,
          hourly_rate: formData.hourlyRate,
          is_verified: true,
          internal_id: internalId
        })

      if (error) throw error

      setTimeout(() => {
        router.push('/tutor/dashboard')
      }, 3000)
    } catch (err: any) {
      alert(err.message)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 my-10 space-y-6">
      {/* Gamification Progress Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg space-y-3 relative overflow-hidden">
        <div className="flex justify-between items-center">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Profile Completion Status</span>
          <span className="text-lg font-black">{completionPercent}%</span>
        </div>
        <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden">
          <div 
            className="bg-emerald-500 h-full transition-all duration-500 rounded-full" 
            style={{ width: `${completionPercent}%` }}
          ></div>
        </div>
        <p className="text-xs text-slate-300">
          {completionPercent < 100 
            ? "⚠️ Complete your profile to 100% so parents hire you and your profile gets fully verified!" 
            : "🎉 Incredible! Your profile is 100% complete and ready for direct parent requests."}
        </p>
      </div>

      {assignedInternalId && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 space-y-1">
          <p className="font-bold text-sm">Profile Verified & 100% Completed!</p>
          <p className="text-xs font-mono">Assigned Internal Tracking ID: {assignedInternalId}</p>
        </div>
      )}

      {/* Form Container */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <form onSubmit={handleFinalSubmit} className="space-y-6">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Step 1: Identity & Contact Details</h2>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => handleInputChange('fullName', e.target.value)}
                  placeholder="e.g., Alee Sabeer"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">CNIC Number</label>
                  <input
                    type="text"
                    required
                    value={formData.cnic}
                    onChange={(e) => handleInputChange('cnic', e.target.value)}
                    placeholder="35202-XXXXXXX-X"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Phone Number</label>
                  <input
                    type="text"
                    required
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    placeholder="0300-1234567"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full py-4 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs uppercase rounded-xl transition-all"
              >
                Next: Location & Academics →
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Step 2: Location & Teaching Specialization</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">City / Region</label>
                  <input
                    type="text"
                    required
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    placeholder="e.g., Lahore"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Area / Neighborhood</label>
                  <input
                    type="text"
                    required
                    value={formData.area}
                    onChange={(e) => handleInputChange('area', e.target.value)}
                    placeholder="e.g., Gulberg / DHA"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Professional Title</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  placeholder="e.g., Expert in Mathematics (O/A Levels)"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-1/3 py-4 bg-gray-100 hover:bg-gray-200 text-slate-700 font-bold text-xs uppercase rounded-xl transition-all"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="w-2/3 py-4 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs uppercase rounded-xl transition-all"
                >
                  Next: Verification & Disclaimer →
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-slate-900">Step 3: Selfie Verification & Marketing Disclaimer</h2>
              
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.selfieUploaded}
                    onChange={(e) => handleInputChange('selfieUploaded', e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-800">I have uploaded my verified camera selfie/profile picture via mobile app</span>
                </label>
              </div>

              {/* Mandatory Marketing Disclaimer */}
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <p className="text-[11px] font-bold text-amber-900 uppercase">Marketing & Promotional Disclaimer</p>
                <p className="text-xs text-amber-800 leading-relaxed">
                  By completing your profile, you acknowledge and agree that your profile picture, title, and bio may be shared on social media, our official website, or promotional advertisements as an educator to maximize your visibility and secure tuition opportunities.
                </p>
                <label className="flex items-center gap-3 pt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={formData.disclaimerAccepted}
                    onChange={(e) => handleInputChange('disclaimerAccepted', e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="text-xs font-bold text-amber-900">I accept the promotional visibility and marketing terms</span>
                </label>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-1/3 py-4 bg-gray-100 hover:bg-gray-200 text-slate-700 font-bold text-xs uppercase rounded-xl transition-all"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-2/3 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl shadow-lg transition-all disabled:opacity-50"
                >
                  {loading ? 'Finalizing Profile & Generating ID...' : 'Complete Profile & Get Verified'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}