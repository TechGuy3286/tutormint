'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ProfileCompletionWidget({ userRole = 'tutor', profileData }: { userRole?: 'tutor' | 'parent', profileData: any }) {
  const [showPopup, setShowPopup] = useState(false)
  const [agreedDisclaimer, setAgreedDisclaimer] = useState(false)
  const [uniqueId, setUniqueId] = useState(profileData?.unique_tracking_id || '')
  const supabase = createClient()

  const calculateProgress = () => {
    let score = 0
    if (userRole === 'tutor') {
      if (profileData?.image_url) score += 25
      if (profileData?.title) score += 25
      if (profileData?.bio) score += 25
      if (profileData?.subjects?.length > 0) score += 25
    } else {
      if (profileData?.full_name) score += 25
      if (profileData?.city) score += 25
      if (profileData?.area) score += 25
      if (profileData?.student_grade) score += 25
    }
    return score
  }

  const completionScore = calculateProgress()

  useEffect(() => {
    if (completionScore < 100) {
      const timer = setTimeout(() => {
        setShowPopup(true)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [completionScore])

  const handleComplete100Percent = async () => {
    if (userRole === 'tutor' && !agreedDisclaimer) {
      alert('Please accept the promotional disclaimer to complete your profile.')
      return
    }

    const generatedId = `TM-${userRole.toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    setUniqueId(generatedId)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from(userRole === 'tutor' ? 'tutor_profiles' : 'parent_profiles')
          .update({ unique_tracking_id: generatedId, profile_completed: true })
          .eq('id', user.id)
      }
      setShowPopup(false)
      alert(`🎉 Congratulations! Your profile is now 100% complete. Unique Tracking ID assigned: ${generatedId}`)
    } catch (err: any) {
      alert(err.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">Profile Completion Status</h3>
            <p className="text-xs text-gray-500 mt-0.5">Complete your checklist to unlock direct parent/tutor matching and referral features.</p>
          </div>
          <span className={`px-3 py-1 text-xs font-extrabold rounded-full ${completionScore === 100 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {completionScore}% Complete
          </span>
        </div>

        <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
          <div className="bg-emerald-600 h-full transition-all duration-500" style={{ width: `${completionScore}%` }} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {userRole === 'tutor' ? (
            <>
              <div className="text-xs flex items-center gap-2 text-gray-700">
                <span>{profileData?.image_url ? '✅' : '❌'}</span> Profile Picture & Mobile App Selfie Verification
              </div>
              <div className="text-xs flex items-center gap-2 text-gray-700">
                <span>{profileData?.title ? '✅' : '❌'}</span> Professional Title
              </div>
              <div className="text-xs flex items-center gap-2 text-gray-700">
                <span>{profileData?.bio ? '✅' : '❌'}</span> Bio & Description
              </div>
              <div className="text-xs flex items-center gap-2 text-gray-700">
                <span>{profileData?.subjects?.length > 0 ? '✅' : '❌'}</span> Selected Subjects
              </div>
            </>
          ) : (
            <>
              <div className="text-xs flex items-center gap-2 text-gray-700">
                <span>{profileData?.full_name ? '✅' : '❌'}</span> Parent Name & Contact
              </div>
              <div className="text-xs flex items-center gap-2 text-gray-700">
                <span>{profileData?.city ? '✅' : '❌'}</span> City Selection
              </div>
              <div className="text-xs flex items-center gap-2 text-gray-700">
                <span>{profileData?.area ? '✅' : '❌'}</span> Area Selection
              </div>
              <div className="text-xs flex items-center gap-2 text-gray-700">
                <span>{profileData?.student_grade ? '✅' : '❌'}</span> Student Grade / Level
              </div>
            </>
          )}
        </div>

        {uniqueId && (
          <div className="p-3 bg-slate-900 text-white rounded-xl text-xs flex justify-between items-center font-mono">
            <span>Internal Tracking ID:</span>
            <span className="text-emerald-400 font-bold">{uniqueId}</span>
          </div>
        )}
      </div>

      {showPopup && completionScore < 100 && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 rounded-3xl max-w-md w-full space-y-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="text-center space-y-2">
              <span className="text-3xl">🚀</span>
              <h3 className="text-lg font-black text-slate-900">Your profile is {completionScore}% complete!</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Complete your profile to 100% so parents can easily hire you and your matching priority increases.
              </p>
            </div>

            {userRole === 'tutor' && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedDisclaimer}
                    onChange={(e) => setAgreedDisclaimer(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-0"
                  />
                  <span className="text-[11px] text-gray-700 font-medium">
                    I agree and give consent that my profile picture and details may be shared on social media, our website, or in promotional ads as a tutor to promote my services.
                  </span>
                </label>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowPopup(false)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs uppercase rounded-xl transition-all"
              >
                Remind Me Later
              </button>
              <button
                onClick={handleComplete100Percent}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md"
              >
                Complete to 100% ✨
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}