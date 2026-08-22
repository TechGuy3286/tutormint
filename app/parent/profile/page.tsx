'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ParentProfilePage() {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    whatsapp: '',
    city: '',
    area: '',
    preferredCurriculum: 'O/A Levels / Matric',
    studentGrade: '',
    disclaimerAccepted: false
  })
  const [loading, setLoading] = useState(false)
  const [completionPercent, setCompletionPercent] = useState(33)
  const [parentInternalId, setParentInternalId] = useState<string | null>(null)
  
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    let score = 33
    if (formData.city && formData.area) score += 33
    if (formData.studentGrade && formData.disclaimerAccepted) score += 34
    setCompletionPercent(score)
  }, [formData])

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleParentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.disclaimerAccepted) {
      alert('Please accept the platform terms to activate your parent profile.')
      return
    }

    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Generate unique internal tracking ID for parent transactions
      const internalId = `PARENT-TRK-${Math.random().toString(36).substring(2, 9).toUpperCase()}`
      setParentInternalId(internalId)

      const { error } = await supabase
        .from('parents')
        .upsert({
          user_id: user.id,
          full_name: formData.fullName,
          phone: formData.phone,
          whatsapp: formData.whatsapp,
          city: formData.city,
          area: formData.area,
          preferred_curriculum: formData.preferredCurriculum,
          student_grade: formData.studentGrade,
          internal_id: internalId,
          is_verified: true
        })

      if (error) throw error

      setTimeout(() => {
        router.push('/parent/dashboard')
      }, 2500)
    } catch (err: any) {
      alert(err.message)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 my-10 space-y-6">
      {/* Parent Checklist & Progress Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg space-y-3 relative overflow-hidden">
        <div className="flex justify-between items-center">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Parent Profile Checklist</span>
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
            ? "📋 Complete your checklist so verified tutors can respond instantly to your demo requests." 
            : "🎯 Profile 100% complete! You are ready to post jobs and connect directly with tutors."}
        </p>
      </div>

      {parentInternalId && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 space-y-1">
          <p className="font-bold text-sm">Parent Account Verified!</p>
          <p className="text-xs font-mono">Internal Tracking ID: {parentInternalId}</p>
        </div>
      )}

      {/* Form Container (No Academic Degrees Required) */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <form onSubmit={handleParentSubmit} className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Parent / Guardian Information</h2>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Full Name</label>
              <input
                type="text"
                required
                value={formData.fullName}
                onChange={(e) => handleInputChange('fullName', e.target.value)}
                placeholder="e.g., Muhammad Tariq"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">WhatsApp Number</label>
                <input
                  type="text"
                  required
                  value={formData.whatsapp}
                  onChange={(e) => handleInputChange('whatsapp', e.target.value)}
                  placeholder="0300-1234567"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">City</label>
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
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Area / Location</label>
                <input
                  type="text"
                  required
                  value={formData.area}
                  onChange={(e) => handleInputChange('area', e.target.value)}
                  placeholder="e.g., DHA Phase 5"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Preferred Curriculum</label>
                <input
                  type="text"
                  required
                  value={formData.preferredCurriculum}
                  onChange={(e) => handleInputChange('preferredCurriculum', e.target.value)}
                  placeholder="e.g., Cambridge / Matric"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Student Grade / Level</label>
                <input
                  type="text"
                  required
                  value={formData.studentGrade}
                  onChange={(e) => handleInputChange('studentGrade', e.target.value)}
                  placeholder="e.g., Class 9 / O-Levels"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={formData.disclaimerAccepted}
                  onChange={(e) => handleInputChange('disclaimerAccepted', e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
                <span className="text-xs font-bold text-slate-800">
                  I agree to connect directly with verified tutors with zero middlemen or commission fees.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl shadow-lg transition-all disabled:opacity-50"
            >
              {loading ? 'Saving Parent Profile...' : 'Save Profile & Open Parent Dashboard'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}