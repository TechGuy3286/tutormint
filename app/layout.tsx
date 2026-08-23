import './globals.css'
import Link from 'next/link'

export const metadata = {
  title: 'TutorMint | Verified Home & Online Tutors Network',
  description: 'Find verified private tutors instantly with zero middlemen.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F8FAFC] font-sans text-[#334155] flex flex-col justify-between antialiased">
        
        {/* GLOBAL CONSISTENT HEADER */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-50 shadow-xs">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <Link href="/" className="text-xl font-black text-[#0F172A] tracking-tight">
              Tutor<span className="text-[#d60008]">Mint</span>
            </Link>

            <div className="flex items-center gap-6 text-xs font-bold text-[#0F172A]">
              <Link href="/parent/dashboard" className="hover:text-[#059669] transition-colors hidden sm:inline-block">
                Parent Portal
              </Link>
              <Link href="/tutor/dashboard" className="hover:text-[#059669] transition-colors hidden sm:inline-block">
                Tutor Portal
              </Link>
              <Link 
                href="/login" 
                className="px-4 py-2.5 bg-[#0F172A] hover:bg-black text-white rounded-xl shadow-sm transition-all"
              >
                Sign In ➔
              </Link>
            </div>
          </div>
        </header>

        {/* MAIN DYNAMIC CONTENT */}
        <div className="flex-1">
          {children}
        </div>

        {/* GLOBAL CONSISTENT FOOTER */}
        <footer className="bg-[#0F172A] text-white py-12 px-6 mt-20 border-t border-slate-800">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 text-center md:text-left">
            <div className="space-y-2">
              <h3 className="text-lg font-black tracking-tight">
                Tutor<span className="text-[#d60008]">Mint</span>
              </h3>
              <p className="text-xs text-slate-400 max-w-sm">
                Pakistan's Largest Verified Tutors Network. Direct 2-party connection with zero hidden middleman commissions.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-6 text-xs text-slate-300 font-medium">
              <div className="space-y-1">
                <p className="font-bold text-white uppercase text-[10px] tracking-wider text-slate-400">Navigation</p>
                <p><Link href="/parent/dashboard" className="hover:underline">Parent Dashboard</Link></p>
                <p><Link href="/tutor/dashboard" className="hover:underline">Tutor Dashboard</Link></p>
              </div>
              <div className="space-y-1">
                <p className="font-bold text-white uppercase text-[10px] tracking-wider text-slate-400">Legal & Support</p>
                <p>Privacy Policy</p>
                <p>Terms of Service</p>
              </div>
            </div>

            <div className="text-xs text-slate-400 space-y-1 text-right md:text-right">
              <p>© {new Date().getFullYear()} TutorMint Inc. All rights reserved.</p>
              <p className="text-[10px] text-slate-500">Lahore, Pakistan • Direct Verified Connections</p>
            </div>
          </div>
        </footer>

      </body>
    </html>
  )
}