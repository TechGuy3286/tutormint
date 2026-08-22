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

      localStorage.setItem("tm_logged_in", "true");
      localStorage.setItem("tm_email", formData.email);
      setIsSuccess(true);
    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 flex-1 w-full text-[#334155]">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6 sm:p-10">
        <div className="text-center mb-8 space-y-2">
          <span className="text-3xl p-3 bg-red-50 rounded-2xl inline-block">🎓</span>
          <h1 className="text-2xl font-black text-[#0F172A]">Join as a Verified Tutor</h1>
          <p className="text-xs text-gray-500 font-medium">
            Create your profile and claim your starting <span className="text-[#d60008] font-black">BONUS 15 application credits</span>. Step {currentStep} of 3.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-[#d60008] rounded-2xl text-xs font-semibold text-center">
            {errorMessage}
          </div>
        )}

        {/* Tab Indicators */}
        <div className="flex justify-between mb-8 border-b border-gray-100">
          {["Identity", "Location & Academics", "Preferences"].map((label, index) => (
            <div 
              key={label} 
              className={`flex-1 text-center font-bold text-xs pb-3 transition-colors ${currentStep === index + 1 ? "text-[#d60008] border-b-2 border-[#d60008]" : "text-gray-400"}`}
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
                <input type="text" name="fullName" value={formData.fullName} onChange={handleInputChange} required className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="e.g. Sir Bilal Ahmed" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Email Address</label>
                  <input type="email" name="email" value={formData.email} onChange={handleInputChange} required className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="bilal@example.com" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">CNIC Number</label>
                  <input type="text" name="cnic" value={formData.cnic} onChange={handleInputChange} required className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="35202-XXXXXXX-X" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Phone Number</label>
                  <input type="text" name="phone_number" value={formData.phone_number} onChange={handleInputChange} required className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="0300-1234567" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">WhatsApp Number</label>
                  <input type="text" name="whatsapp_number" value={formData.whatsapp_number} onChange={handleInputChange} className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="Same as phone" />
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Province</label>
                  <select name="province" value={formData.province} onChange={handleInputChange} className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" required>
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
                  <input type="text" name="city" value={formData.city} onChange={handleInputChange} required className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="e.g. Lahore" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Area Name</label>
                  <input type="text" name="areaName" value={formData.areaName} onChange={handleInputChange} required className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="e.g. DHA Phase 5" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Highest Academic Degree(s)</label>
                <input type="text" name="degrees" value={formData.degrees} onChange={handleInputChange} required className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="e.g. BS Mathematics (LUMS), MSc Physics" />
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Teaching Mode</label>
                <select name="teachingMode" value={formData.teachingMode} onChange={handleInputChange} className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]">
                  <option value="Physical">Physical (In-Person)</option>
                  <option value="Online">Online Only</option>
                  <option value="Both">Both (Physical & Online)</option>
                </select>
              </div>
              {formData.teachingMode !== "Physical" && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Preferred Online Platforms</label>
                  <input type="text" name="onlinePlatforms" value={formData.onlinePlatforms} onChange={handleInputChange} className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs text-[#334155] focus:bg-white focus:outline-none focus:border-[#0F172A]" placeholder="e.g. Zoom, Google Meet, Skype" />
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-6 border-t border-gray-100">
            {currentStep > 1 ? (
              <button type="button" onClick={prevStep} disabled={isSubmitting} className="px-6 py-3 border border-gray-200 rounded-xl font-bold text-xs text-[#334155] hover:bg-gray-50 transition-all">
                Back
              </button>
            ) : <div />}
            
            {currentStep < 3 ? (
              <button type="button" onClick={nextStep} className="px-8 py-3 bg-[#0F172A] hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-md transition-all">
                Continue →
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} disabled={isSubmitting} className="px-8 py-3 bg-[#d60008] hover:bg-red-700 text-white rounded-xl font-bold text-xs shadow-lg transition-all disabled:opacity-50">
                {isSubmitting ? "Submitting..." : "Submit & Claim 15 Credits ⚡"}
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Success Modal */}
      {isSuccess && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="text-emerald-500 text-5xl">✅</div>
            <h2 className="text-xl font-black text-[#0F172A]">Application Received!</h2>
            <p className="text-xs text-gray-600 font-medium leading-relaxed">
              Your tutor registration was successful. You can now access your dashboard to view active leads and verification status.
            </p>
            <button onClick={() => router.push('/tutor/dashboard')} className="w-full py-3.5 bg-[#0F172A] hover:bg-emerald-600 text-white rounded-xl font-bold text-xs shadow-md transition-all">
              Go to Dashboard →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}