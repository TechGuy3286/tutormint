'use client'

import Link from 'next/link'

interface TutorCardProps {
  tutor: {
    id?: string
    user_id?: string
    full_name?: string
    avatar_url?: string
    rating?: number | string
    reviews_count?: number | string
    subjects?: string
    headline?: string
    gender?: string
    degree?: string
    city?: string
    hourly_rate?: number | string
    phone?: string
    whatsapp?: string
  }
  isSaved: boolean
  onToggleBookmark: (tutorId: string, e: React.MouseEvent) => void
}

export default function TutorCard({ tutor, isSaved, onToggleBookmark }: TutorCardProps) {
  const tutorId = tutor.id || tutor.user_id
  const avatarUrl = tutor.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tutor.full_name || 'Tutor'}`
  const tutorPhone = tutor.phone || tutor.whatsapp || '923215872222'
  const whatsappLink = `https://wa.me/${tutorPhone}?text=Assalam-o-Alaikum%20${encodeURIComponent(tutor.full_name || 'Tutor')},%20I%20found%20your%20profile%20on%20TutorMint%20and%20want%20to%20discuss%20tuition.`

  return (
    <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:shadow-md transition-all relative">
      
      {/* Left: Round Avatar with Heart Badge Directly Attached */}
      <div className="flex items-center gap-6 w-full sm:w-auto">
        <div className="relative shrink-0">
          <img 
            src={avatarUrl} 
            alt={tutor.full_name || 'Tutor'} 
            className="h-20 w-20 sm:h-24 sm:w-24 aspect-square rounded-full object-cover bg-gray-50 border-2 border-gray-100 shadow-sm" 
          />
          {/* Red Heart Badge on Avatar */}
          <button 
            onClick={(e) => onToggleBookmark(tutorId!, e)}
            className="absolute bottom-0 right-0 p-2 bg-white hover:bg-red-50 rounded-full border border-gray-200 shadow-sm transition-all text-xs flex items-center justify-center text-red-600"
            title={isSaved ? "Remove from Shortlist" : "Shortlist Tutor"}
          >
            {isSaved ? '❤️' : '🤍'}
          </button>
        </div>

        <div className="space-y-2 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href={`/browse/${tutorId}`} className="text-base sm:text-lg font-black text-[#0F172A] hover:underline">
              {tutor.full_name || 'Verified Tutor'}
            </Link>
            
            <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[11px] font-bold rounded-lg border border-blue-100">
              ✓ Verified
            </span>

            <span className="px-2.5 py-1 bg-amber-50 text-amber-800 text-[11px] font-extrabold rounded-lg border border-amber-200 flex items-center gap-1">
              ⭐ {tutor.rating || '5.0'} <span className="text-gray-400 font-normal">({tutor.reviews_count || '12'})</span>
            </span>
          </div>
          
          <p className="text-xs sm:text-sm font-bold text-[#0d9488]">
            {tutor.subjects ? `Expert in ${tutor.subjects}` : (tutor.headline || 'Expert Tutor')} 
            {tutor.gender ? ` • ${tutor.gender}` : ''}
          </p>

          <p className="text-xs text-gray-600 flex flex-wrap items-center gap-3 font-medium">
            <span>🎓 {tutor.degree || 'Qualified Educator'}</span>
            <span>•</span>
            <span>📍 {tutor.city || 'Available Online & Home'}</span>
            <span>•</span>
            <span className="font-bold text-[#0F172A]">💰 {tutor.hourly_rate ? `Rs. ${tutor.hourly_rate}/hr` : 'Negotiable'}</span>
          </p>
        </div>
      </div>

      {/* Right: WhatsApp & View Profile Buttons */}
      <div className="w-full sm:w-auto flex items-center gap-3 justify-end shrink-0 pt-2 sm:pt-0">
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs transition-all flex items-center gap-2"
        >
          💬 WhatsApp
        </a>
        <Link
          href={`/browse/${tutorId}`}
          className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-[#0F172A] font-bold text-xs rounded-xl transition-all border border-gray-200"
        >
          View Profile
        </Link>
      </div>
    </div>
  )
}