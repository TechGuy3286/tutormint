'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/navigation'
import { useParams } from 'next/navigation'

export default function PublicTutorProfilePage() {
  const [tutor, setTutor] = useState<any>(null)
  const [reviews, setReviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // Review form states
  const [parentName, setParentName] = useState('')
  const [rating, setRating] = useState('5')
  const [comment, setComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)
  const [reviewSuccess, setReviewSuccess] = useState(false)

  const params = useParams()
  const supabase = createClient()

  useEffect(() => {
    if (params?.id) {
      fetchTutorAndReviews(params.id as string)
    }
  }, [params])

  const fetchTutorAndReviews = async (id: string) => {
    setLoading(true)
    try {
      let tutorData = null
      let { data, error } = await supabase.from('tutors').select('*').eq('id', id).single()

      if (!error && data) {
        tutorData = data
      } else {
        const { data: userData } = await supabase.from('tutors').select('*').eq('user_id', id).single()
        if (userData) tutorData = userData
      }

      setTutor(tutorData)

      if (tutorData) {
        const tutorKey = tutorData.id || tutorData.user_id
        const { data: reviewData } = await supabase
          .from('reviews')
          .select('*')
          .or(`tutor_id.eq.${tutorKey},tutor_user_id.eq.${tutorKey}`)
          .order('created_at', { ascending: false })

        if (reviewData) setReviews(reviewData)
      }
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parentName.trim() || !comment.trim()) return

    setSubmittingReview(true)
    try {
      const tutorKey = tutor.id || tutor.user_id
      const { error } = await supabase.from('reviews').insert([
        {
          tutor_id: tutorKey,
          parent_name: parentName,
          rating: Number(rating),
          comment: comment,
          created_at: new Date().toISOString()
        }
      ])

      if (error) throw error

      setReviewSuccess(true)
      setParentName('')
      setComment('')
      fetchTutorAndReviews(tutorKey)
      setTimeout(() => setReviewSuccess(false), 5000)
    } catch (err) {
      console.error('Error submitting review:', err)
      alert('Failed to submit review. Please try again.')
    } finally {
      setSubmittingReview(false)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-400">Loading tutor profile...</div>

  if (!tutor) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-3 bg-[#F8FAFC] text-center p-6">
        <h2 className="text-base font-black text-[#0F172A]">Tutor Profile Not Found</h2>
        <a href="/browse" className="px-6 py-3 bg-[#0F172A] text-white font-bold text-xs rounded-xl">← Back to Tutors Directory</a>
      </div>
    )
  }

  const tutorId = tutor.id || tutor.user_id
  const avatarUrl = tutor.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tutor.full_name || 'Tutor'}`
  const tutorPhone = tutor.phone || tutor.whatsapp || '923211045245'
  const whatsappLink = `https://wa.me/${tutorPhone}?text=Assalam-o-Alaikum%20${encodeURIComponent(tutor.full_name || 'Tutor')},%20I%20found%20your%20profile%20on%20TutorMint.`

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-10 px-4 sm:px-12 text-[#334155]">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Breadcrumb */}
        <div className="text-xs font-bold text-gray-400 flex items-center gap-2">
          <a href="/" className="hover:text-[#0F172A]">Home</a>
          <span>/</span>
          <a href="/browse" className="hover:text-[#0F172A]">Find Tutors</a>
          <span>/</span>
          <span className="text-[#0F172A]">{tutor.full_name || 'Profile'}</span>
        </div>

        {/* Profile Header */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <img src={avatarUrl} alt={tutor.full_name || 'Tutor'} className="h-24 w-24 sm:h-28 sm:w-28 aspect-square rounded-3xl object-cover bg-gray-100 border border-gray-200 shrink-0" />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">{tutor.full_name || 'Verified Tutor'}</h1>
                <span className="px-2.5 py-1 bg-amber-50 text-amber-800 text-xs font-extrabold rounded-lg border border-amber-200">
                  ⭐ {tutor.rating || '5.0'} ({reviews.length} reviews)
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-extrabold rounded-md border border-emerald-200">🛡️ Background Verified</span>
                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-extrabold rounded-md border border-blue-200">🆔 CNIC Verified</span>
              </div>
              
              <p className="text-xs sm:text-sm font-bold text-[#0d9488]">{tutor.subjects ? `Expert in ${tutor.subjects}` : 'Expert Tutor'}</p>
              <p className="text-xs text-gray-500">🎓 {tutor.degree || 'Qualified Educator'} • 📍 {tutor.city || 'Lahore'}</p>
            </div>
          </div>

          <div className="w-full sm:w-auto flex flex-col gap-2 shrink-0">
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="w-full text-center px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-md transition-all flex items-center justify-center gap-2">
              💬 Chat on WhatsApp
            </a>
          </div>
        </div>

        {/* Details & Reviews */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
              <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-wider">About Educator</h3>
              <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                {tutor.bio || 'Dedicated educator focused on building strong conceptual foundations and ensuring academic excellence.'}
              </p>
            </div>

            {/* Parent Reviews & Submission Form */}
            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-6">
              <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-wider">Parent Feedback & Reviews</h3>

              {reviewSuccess && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold">
                  ✅ Thank you! Your verified review has been successfully posted.
                </div>
              )}

              {/* Review Submission Form */}
              <form onSubmit={handleReviewSubmit} className="p-5 bg-[#F8FAFC] rounded-2xl border border-gray-200 space-y-3">
                <h4 className="text-xs font-black text-[#0F172A]">Leave a Review for this Tutor</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input 
                    type="text" 
                    placeholder="Your Name (e.g. Mr. Ahmed)" 
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    required
                    className="p-3 bg-white border border-gray-200 rounded-xl text-xs outline-none font-bold"
                  />
                  <select 
                    value={rating} 
                    onChange={(e) => setRating(e.target.value)}
                    className="p-3 bg-white border border-gray-200 rounded-xl text-xs outline-none font-bold"
                  >
                    <option value="5">⭐⭐⭐⭐⭐ (5/5 Excellent)</option>
                    <option value="4">⭐⭐⭐⭐ (4/5 Very Good)</option>
                    <option value="3">⭐⭐⭐ (3/5 Good)</option>
                  </select>
                </div>
                <textarea 
                  placeholder="Write your feedback regarding teaching methodology, punctuality, and student progress..." 
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  required
                  className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs outline-none font-bold"
                />
                <button 
                  type="submit" 
                  disabled={submittingReview}
                  className="px-6 py-2.5 bg-[#d60008] hover:bg-red-700 text-white font-black text-xs rounded-xl shadow-xs transition-all"
                >
                  {submittingReview ? 'Submitting...' : 'Submit Verified Review'}
                </button>
              </form>

              {reviews.length === 0 ? (
                <p className="text-xs text-gray-500 py-4 text-center">No reviews yet. Be the first parent to review!</p>
              ) : (
                <div className="space-y-4 pt-2">
                  {reviews.map((rev, idx) => (
                    <div key={idx} className="p-4 bg-[#F8FAFC] rounded-2xl border border-gray-100 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-[#0F172A]">{rev.parent_name || 'Verified Parent'}</span>
                        <span className="text-xs font-extrabold text-amber-600">⭐ {rev.rating || '5.0'}</span>
                      </div>
                      <p className="text-xs text-gray-600">{rev.comment || rev.feedback}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-4">
              <h3 className="text-xs font-black text-[#0F172A] uppercase tracking-wider">Session & Key Metrics</h3>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-400 font-medium">Experience</span>
                  <span className="font-bold text-[#334155]">{tutor.experience_years || '5+ Years'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-400 font-medium">Expected Fee</span>
                  <span className="font-black text-[#0F172A]">{tutor.hourly_rate ? `Rs. ${tutor.hourly_rate}/hr` : 'Negotiable'}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-400 font-medium">Location</span>
                  <span className="font-bold text-[#334155]">{tutor.city || 'Lahore'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}