'use client'
import { Send } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import { useState } from 'react'

export default function ReviewPage() {
  const [reviewType, setReviewType] = useState<'parent-to-tutor' | 'tutor-to-parent'>('parent-to-tutor')
  
  // Parent to Tutor ratings
  const [demoRating, setDemoRating] = useState(5)
  const [methodRating, setMethodRating] = useState(5)
  const [parentComment, setParentComment] = useState('')

  // Tutor to Parent ratings
  const [parentReliabilityRating, setParentReliabilityRating] = useState(5)
  const [tutorComment, setTutorComment] = useState('')

  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <Breadcrumbs items={[{ label: 'Leave a review' }]} />
        
        {/* Header */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 text-center space-y-3">
          <span className="px-3 py-1 bg-tm-tint-green text-tm-green-deep text-xs font-bold rounded-full border border-tm-green-deep/30 uppercase tracking-widest">
            Mutual Accountability System
          </span>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Post-Tuition Feedback & Ratings</h1>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Build community trust. Both parents and tutors review each other to maintain high standards across TutorMint.
          </p>
        </div>

        {/* Switcher */}
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-200 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setReviewType('parent-to-tutor'); setSubmitted(false); }}
            className={`py-3 text-xs font-bold rounded-xl transition-all ${
              reviewType === 'parent-to-tutor'
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Parent Reviewing Tutor
          </button>
          <button
            type="button"
            onClick={() => { setReviewType('tutor-to-parent'); setSubmitted(false); }}
            className={`py-3 text-xs font-bold rounded-xl transition-all ${
              reviewType === 'tutor-to-parent'
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Tutor Reviewing Parent
          </button>
        </div>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 space-y-6">
            
            {reviewType === 'parent-to-tutor' ? (
              <>
                <div className="border-b border-gray-100 pb-4">
                  <h2 className="text-base font-bold text-slate-900">Reviewing: Sir Bilal Ahmed (TM-8821)</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Job ID: JOB-TM-4821</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">1. Demo Class Experience Rating (1-5)</label>
                  <select
                    value={demoRating}
                    onChange={(e) => setDemoRating(Number(e.target.value))}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-tm-green-deep outline-none"
                  >
                    <option value={5}>⭐⭐⭐⭐⭐ (5/5 - Exceptional & Punctual)</option>
                    <option value={4}>⭐⭐⭐⭐ (4/5 - Good)</option>
                    <option value={3}>⭐⭐⭐ (3/5 - Average)</option>
                    <option value={2}>⭐⭐ (2/5 - Poor)</option>
                    <option value={1}>⭐ (1/5 - Did Not Respond / Late)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">2. Teaching Method & Subject Mastery Rating (1-5)</label>
                  <select
                    value={methodRating}
                    onChange={(e) => setMethodRating(Number(e.target.value))}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-tm-green-deep outline-none"
                  >
                    <option value={5}>⭐⭐⭐⭐⭐ (5/5 - Excellent Explanation & Engagement)</option>
                    <option value={4}>⭐⭐⭐⭐ (4/5 - Very Good)</option>
                    <option value={3}>⭐⭐⭐ (3/5 - Satisfactory)</option>
                    <option value={2}>⭐⭐ (2/5 - Needs Improvement)</option>
                    <option value={1}>⭐ (1/5 - Unsatisfactory)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Detailed Parent Feedback</label>
                  <textarea
                    rows={4}
                    required
                    value={parentComment}
                    onChange={(e) => setParentComment(e.target.value)}
                    placeholder="Share how the tutor handled the sessions and student progress..."
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-tm-green-deep outline-none resize-none"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="border-b border-gray-100 pb-4">
                  <h2 className="text-base font-bold text-slate-900">Reviewing Parent: Mr. Tariq Mahmood</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Job ID: JOB-TM-4821</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Parent Reliability & Environment Rating (1-5)</label>
                  <select
                    value={parentReliabilityRating}
                    onChange={(e) => setParentReliabilityRating(Number(e.target.value))}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-tm-green-deep outline-none"
                  >
                    <option value={5}>⭐⭐⭐⭐⭐ (5/5 - Highly Professional & Respectful)</option>
                    <option value={4}>⭐⭐⭐⭐ (4/5 - Good)</option>
                    <option value={3}>⭐⭐⭐ (3/5 - Average)</option>
                    <option value={2}>⭐⭐ (2/5 - Communication Issues)</option>
                    <option value={1}>⭐ (1/5 - Unreliable)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Tutor Feedback on Parent</label>
                  <textarea
                    rows={4}
                    required
                    value={tutorComment}
                    onChange={(e) => setTutorComment(e.target.value)}
                    placeholder="Share your experience teaching for this parent to guide future tutors..."
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-tm-green-deep outline-none resize-none"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 w-full py-4 bg-slate-900 hover:bg-tm-green-deep text-white font-bold text-xs rounded-xl shadow-lg transition-all"
            >
              <Send aria-hidden size={14} />
              Submit Review & Publish to Profile
            </button>
          </form>
        ) : (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 text-center space-y-4">
            <div className="w-16 h-16 bg-tm-tint-green text-tm-green-deep rounded-full flex items-center justify-center text-2xl font-bold mx-auto">
              ✓
            </div>
            <h2 className="text-xl font-bold text-slate-900">Review Submitted Successfully!</h2>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              Thank you for keeping TutorMint transparent and accountable. Your feedback is now reflected on the profile metrics.
            </p>
          </div>
        )}

      </div>
    </main>
  )
}