import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col justify-between font-sans text-[#161616]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center max-w-7xl mx-auto w-full">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/tutor/login" className="text-sm font-semibold text-gray-700 hover:text-[#B3191F]">
            Tutor Login
          </Link>
          <Link href="/parent/login" className="text-sm font-semibold text-gray-700 hover:text-[#B3191F]">
            Parent Login
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-6 py-16 text-center flex-grow flex flex-col justify-center">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6">
          Find Verified Tutors or <span className="text-[#B3191F]">Grow Your Teaching Career</span>
        </h1>
        <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-10">
          TutorMint connects qualified home and online educators with parents and students seeking top-tier academic excellence across a nationwide footprint.
        </p>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto w-full">
          {/* Tutor Card */}
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 flex flex-col justify-between text-left hover:border-[#B3191F] transition-colors">
            <div>
              <span className="text-xs font-bold text-[#B3191F] uppercase tracking-wider block mb-2">For Educators</span>
              <h3 className="text-2xl font-extrabold mb-3">Join as a Tutor</h3>
              <p className="text-gray-500 text-sm mb-6">
                Register your profile, list your academic credentials, choose your preferred teaching modes, and connect with students.
              </p>
            </div>
            <div className="flex gap-3">
              <Link href="/tutor/register" className="flex-1 py-3 bg-[#B3191F] text-white rounded-lg font-bold text-center hover:bg-red-800 transition-colors">
                Register
              </Link>
              <Link href="/tutor/login" className="px-4 py-3 border border-gray-300 rounded-lg font-bold text-center hover:bg-gray-50 transition-colors">
                Login
              </Link>
            </div>
          </div>

          {/* Parent / Student Card */}
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 flex flex-col justify-between text-left hover:border-[#B3191F] transition-colors">
            <div>
              <span className="text-xs font-bold text-[#B3191F] uppercase tracking-wider block mb-2">For Parents & Students</span>
              <h3 className="text-2xl font-extrabold mb-3">Hire a Tutor</h3>
              <p className="text-gray-500 text-sm mb-6">
                Create your student profile and browse a verified catalog of experienced home and online educators ready to help.
              </p>
            </div>
            <div className="flex gap-3">
              <Link href="/parent/register" className="flex-1 py-3 bg-[#B3191F] text-white rounded-lg font-bold text-center hover:bg-red-800 transition-colors">
                Register
              </Link>
              <Link href="/parent/login" className="px-4 py-3 border border-gray-300 rounded-lg font-bold text-center hover:bg-gray-50 transition-colors">
                Login
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-6 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} TutorMint. All rights reserved.
      </footer>
    </div>
  );
}