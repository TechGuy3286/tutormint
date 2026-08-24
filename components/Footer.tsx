import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-white border-t border-gray-200 py-12 px-4 sm:px-12 text-[#334155] mt-20">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
        
        {/* Col 1: Brand */}
        <div className="space-y-3">
          <h3 className="text-sm font-black text-[#0F172A]">TutorMint</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Pakistan's Largest Verified Tutors Network. Connecting parents with background-verified home and online tutors instantly.
          </p>
        </div>

        {/* Col 2: Quick Links */}
        <div className="space-y-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Quick Links</h4>
          <ul className="space-y-1.5 text-xs">
            <li><Link href="/browse" className="text-gray-500 hover:text-[#d60008]">Find Tutors</Link></li>
            <li><Link href="/parent/dashboard/post-job" className="text-gray-500 hover:text-[#d60008]">Post a Tuition Job</Link></li>
            <li><Link href="/" className="text-gray-500 hover:text-[#d60008]">Home</Link></li>
          </ul>
        </div>

        {/* Col 3: Cities */}
        <div className="space-y-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Top Cities</h4>
          <p className="text-xs text-gray-500 leading-relaxed">
            Lahore • Karachi • Islamabad • Rawalpindi • Faisalabad • Multan
          </p>
        </div>

        {/* Col 4: Contact */}
        <div className="space-y-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Contact Support</h4>
          <p className="text-xs text-gray-500">WhatsApp: +92 321 5872222</p>
          <p className="text-xs text-gray-500">Email: support@tutormint.org</p>
        </div>

      </div>

      <div className="max-w-6xl mx-auto pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400">
        <p>© 2026 TutorMint. All rights reserved.</p>
        <p>Empowering Education Across Pakistan</p>
      </div>
    </footer>
  )
}