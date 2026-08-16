"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function TutorRegistration() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    cnic: "",
    phone_number: "",
    whatsapp_number: "",
    province: "",
    city: "",
    areaName: "",
    degrees: "",
    teachingMode: "Physical",
    onlinePlatforms: "",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, 3));
  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 1));

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const form = document.getElementById("tutor-registration-form") as HTMLFormElement;
    if (form && !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/tutor/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to submit application. Please try again later.");
      }

      localStorage.setItem("tutorEmail", formData.email);
      setIsSuccess(true);
    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Tutor Registration</span>
        </Link>
        <Link href="/" className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors">
          🏠 Home
        </Link>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-12 flex-1 w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-6 space-y-1">
            <span className="text-3xl">🎓</span>
            <h1 className="text-2xl font-extrabold">Join as a Verified Tutor</h1>
            <p className="text-xs text-gray-500 font-semibold">
              Create your profile and claim your starting <span className="text-[#B3191F] font-black">BONUS 15 application credits</span>. Step {currentStep} of 3.
            </p>
          </div>

          {errorMessage && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
              {errorMessage}
            </div>
          )}

          {/* Tab Indicators */}
          <div className="flex justify-between mb-8 border-b border-gray-200">
            {["Identity", "Location & Academics", "Preferences"].map((label, index) => (
              <div 
                key={label} 
                className={`flex-1 text-center font-bold text-xs pb-3 ${currentStep === index + 1 ? "text-[#B3191F] border-b-2 border-[#B3191F]" : "text-gray-400"}`}
              >
                {label}
              </div>
            ))}
          </div>

          <form id="tutor-registration-form" className="space-y-6">
            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Full Name</label>
                  <input type="text" name="fullName" value={formData.fullName} onChange={handleInputChange} required className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="e.g. Ali Sabeer" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Email Address</label>
                    <input type="email" name="email" value={formData.email} onChange={handleInputChange} required className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="ali@example.com" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">CNIC Number</label>
                    <input type="text" name="cnic" value={formData.cnic} onChange={handleInputChange} required className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="35202-XXXXXXX-X" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Phone Number</label>
                    <input type="text" name="phone_number" value={formData.phone_number} onChange={handleInputChange} required className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="0300-1234567" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">WhatsApp Number</label>
                    <input type="text" name="whatsapp_number" value={formData.whatsapp_number} onChange={handleInputChange} className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="Same as phone" />
                  </div>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Province</label>
                    <select name="province" value={formData.province} onChange={handleInputChange} className="w-full border border-gray-200 rounded-xl p-3 text-xs bg-white focus:outline-none focus:border-black" required>
                      <option value="">Select Province</option>
                      <option value="Punjab">Punjab</option>
                      <option value="Sindh">Sindh</option>
                      <option value="KPK">Khyber Pakhtunkhwa</option>
                      <option value="Balochistan">Balochistan</option>
                      <option value="Federal">Federal (Islamabad)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">City Name</label>
                    <input type="text" name="city" value={formData.city} onChange={handleInputChange} required className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="e.g. Lahore" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Area Name</label>
                    <input type="text" name="areaName" value={formData.areaName} onChange={handleInputChange} required className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="e.g. Gulberg III" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Highest Academic Degree(s)</label>
                  <input type="text" name="degrees" value={formData.degrees} onChange={handleInputChange} required className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="e.g. BS Computer Science (PU), MSc Physics" />
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Teaching Mode</label>
                  <select name="teachingMode" value={formData.teachingMode} onChange={handleInputChange} className="w-full border border-gray-200 rounded-xl p-3 text-xs bg-white focus:outline-none focus:border-black">
                    <option value="Physical">Physical (In-Person)</option>
                    <option value="Online">Online Only</option>
                    <option value="Both">Both (Physical & Online)</option>
                  </select>
                </div>
                {formData.teachingMode !== "Physical" && (
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Preferred Online Platforms</label>
                    <input type="text" name="onlinePlatforms" value={formData.onlinePlatforms} onChange={handleInputChange} className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:outline-none focus:border-black" placeholder="e.g. Zoom, Google Meet" />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between pt-6 border-t border-gray-100">
              {currentStep > 1 ? (
                <button type="button" onClick={prevStep} disabled={isSubmitting} className="px-6 py-2.5 border border-gray-200 rounded-xl font-bold text-xs text-gray-700 hover:bg-gray-50">
                  Back
                </button>
              ) : <div />}
              
              {currentStep < 3 ? (
                <button type="button" onClick={nextStep} className="px-8 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white rounded-xl font-bold text-xs shadow-sm">
                  Continue →
                </button>
              ) : (
                <button type="button" onClick={handleSubmit} disabled={isSubmitting} className="px-8 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white rounded-xl font-bold text-xs shadow-sm disabled:opacity-50">
                  {isSubmitting ? "Submitting..." : "Submit & Claim 15 Credits ⚡"}
                </button>
              )}
            </div>
          </form>
        </div>
      </main>

      {/* Success Modal */}
      {isSuccess && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center space-y-4">
            <div className="text-emerald-500 text-5xl">✅</div>
            <h2 className="text-xl font-black">Application Received!</h2>
            <p className="text-xs text-gray-600 font-medium leading-relaxed">
              Tutor Application received! Our team will review your credentials and contact you on your provided contact details.
            </p>
            <button onClick={() => router.push('/tutor/dashboard')} className="w-full py-3 bg-[#B3191F] text-white rounded-xl font-bold text-xs shadow-sm">
              Go to Dashboard →
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex justify-between items-center max-w-6xl mx-auto w-full">
        <div>© 2026 TutorMint. All rights reserved.</div>
        <div className="flex space-x-6 text-[11px]">
          <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
          <Link href="/support" className="hover:text-gray-600">Support</Link>
        </div>
      </footer>
    </div>
  );
}