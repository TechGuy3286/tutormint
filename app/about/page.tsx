"use client";
import Breadcrumbs from '@/components/Breadcrumbs'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-50 font-sans text-tm-black flex flex-col justify-between">
      {/* The page's own sticky wordmark bar is gone: components/Navbar.tsx is
          the site header, and two sticky bars at top-0 stack on top of each
          other. The same duplication was found and removed for the footer in
          T-UI1. The breadcrumb replaces its Home button. */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex-1 w-full space-y-6">
        <Breadcrumbs items={[{ label: 'About' }]} />
        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm space-y-6">
          <h1 className="text-3xl font-black tracking-tight text-gray-900">About TutorMint</h1>
          <p className="text-xs text-gray-500 font-semibold">The premier ecosystem connecting parents and schools with camera-verified home tutors.</p>
          
          <div className="space-y-4 text-xs text-gray-600 leading-relaxed">
            <p>TutorMint was founded with a singular mission: to eliminate fake credentials and provide families across Pakistan with absolute peace of mind when hiring home educators.</p>
            
            <h3 className="text-sm font-extrabold text-gray-900 pt-2">Our Core Standard: Camera Verification</h3>
            <p>Unlike traditional classified platforms where anyone can post fake degrees, every educator on TutorMint records a live 60-second video introduction showcasing their actual academic certificates on camera, reviewed and verified by our administrative team.</p>

            <h3 className="text-sm font-extrabold text-gray-900 pt-2">Empowering Tutors & Clients</h3>
            <p>We provide tutors with starting bonus application credits and high-value tuition opportunities while giving parents and academies an intuitive dashboard to post requirements and hire trusted professionals.</p>
          </div>
        </div>
      </main>
    </div>
  );
}