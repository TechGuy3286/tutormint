// app/privacy/page.tsx
import Link from "next/link";
export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between p-6">
      <div className="max-w-3xl mx-auto w-full bg-white p-8 rounded-2xl border border-gray-200 shadow-sm space-y-4 my-auto">
        <Link href="/" className="text-xs text-gray-400 font-bold">← Back to Home</Link>
        <h1 className="text-2xl font-black">Privacy Policy</h1>
        <p className="text-xs text-gray-600 leading-relaxed">
          At TutorMint, we take your privacy seriously. All data collected including CNIC records, contact numbers, and video verification proofs are securely encrypted and used strictly for matchmaking verified tutors with parents and academic clients.
        </p>
      </div>
      <footer className="text-center text-xs text-gray-400">© 2026 TutorMint</footer>
    </div>
  );
}