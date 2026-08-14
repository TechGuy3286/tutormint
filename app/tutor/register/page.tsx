"use client";

import { useState } from "react";
import Link from "next/link";

export default function TutorRegistration() {
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

      // Trigger the popup modal instead of a full page redirect
      setIsSuccess(true);
    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center pt-12 px-4 font-sans text-[#161616] relative">
      <Link href="/" className="text-3xl font-bold tracking-tight mb-8">
        Tutor<span className="text-[#B3191F]">Mint</span>
      </Link>

      <div className="bg-white max-w-2xl w-full rounded-xl shadow-sm border border-[#EDEDED] p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold mb-2">Join as a Tutor</h1>
          <p className="text-gray-500">Step {currentStep} of 3: Create your nationwide profile.</p>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm font-semibold">
            {errorMessage}
          </div>
        )}

        {/* Tab Indicators */}
        <div className="flex justify-between mb-8 border-b border-gray-200">
          {["Identity", "Location & Academics", "Preferences"].map((label, index) => (
            <div 
              key={label} 
              className={`flex-1 text-center font-semibold text-sm pb-4 ${currentStep === index + 1 ? "text-[#B3191F] border-b-2 border-[#B3191F]" : "text-gray-400"}`}
            >
              {label}
            </div>
          ))}
        </div>

        <form id="tutor-registration-form" className="space-y-6">
          {/* STEP 1: IDENTITY */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Full Name</label>
                <input type="text" name="fullName" value={formData.fullName} onChange={handleInputChange} required className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" placeholder="e.g. Ali Raza" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Email Address</label>
                  <input type="email" name="email" value={formData.email} onChange={handleInputChange} required className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" placeholder="ali@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">CNIC Number</label>
                  <input type="text" name="cnic" value={formData.cnic} onChange={handleInputChange} required className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" placeholder="35202-XXXXXXX-X" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Phone Number</label>
                  <input type="text" name="phone_number" value={formData.phone_number} onChange={handleInputChange} required className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" placeholder="0300-1234567" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">WhatsApp Number</label>
                  <input type="text" name="whatsapp_number" value={formData.whatsapp_number} onChange={handleInputChange} className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" placeholder="Same as phone" />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: LOCATION & ACADEMICS */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Province</label>
                  <select name="province" value={formData.province} onChange={handleInputChange} className="w-full border border-gray-300 rounded-md p-3 bg-white focus:outline-none focus:border-[#B3191F]" required>
                    <option value="">Select Province</option>
                    <option value="Punjab">Punjab</option>
                    <option value="Sindh">Sindh</option>
                    <option value="KPK">Khyber Pakhtunkhwa</option>
                    <option value="Balochistan">Balochistan</option>
                    <option value="Federal">Federal (Islamabad)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">City</label>
                  <input type="text" name="city" value={formData.city} onChange={handleInputChange} required className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" placeholder="e.g. Lahore, Karachi, Islamabad" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Highest Academic Degree(s)</label>
                <input type="text" name="degrees" value={formData.degrees} onChange={handleInputChange} required className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" placeholder="e.g. BS Computer Science (PU), MSc Physics" />
              </div>
            </div>
          )}

          {/* STEP 3: PREFERENCES */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Teaching Mode</label>
                <select name="teachingMode" value={formData.teachingMode} onChange={handleInputChange} className="w-full border border-gray-300 rounded-md p-3 bg-white focus:outline-none focus:border-[#B3191F]">
                  <option value="Physical">Physical (In-Person)</option>
                  <option value="Online">Online Only</option>
                  <option value="Both">Both (Physical & Online)</option>
                </select>
              </div>
              {formData.teachingMode !== "Physical" && (
                <div>
                  <label className="block text-sm font-semibold mb-1">Preferred Online Platforms</label>
                  <input type="text" name="onlinePlatforms" value={formData.onlinePlatforms} onChange={handleInputChange} className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" placeholder="e.g. Zoom, Google Meet, Skype" />
                </div>
              )}
            </div>
          )}

          {/* Form Navigation Controls */}
          <div className="flex justify-between pt-6 mt-6 border-t border-gray-100">
            {currentStep > 1 ? (
              <button type="button" onClick={prevStep} disabled={isSubmitting} className="px-6 py-3 border-2 border-gray-300 rounded-md font-bold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                Back
              </button>
            ) : (
              <div></div>
            )}
            
            {currentStep < 3 ? (
              <button type="button" onClick={nextStep} className="px-8 py-3 bg-[#B3191F] text-white rounded-md font-bold hover:bg-red-800 transition-colors">
                Continue
              </button>
            ) : (
              <button 
                type="button" 
                onClick={handleSubmit} 
                disabled={isSubmitting} 
                className="px-8 py-3 bg-[#B3191F] text-white rounded-md font-bold hover:bg-red-800 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? "Submitting..." : "Submit Application"}
              </button>
            )}
          </div>
        </form>
      </div>

      {/* SUCCESS POPUP MODAL */}
      {isSuccess && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-sm w-full text-center animate-in zoom-in-95 duration-200">
            <div className="text-[#10B981] mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <h2 className="text-2xl font-extrabold mb-3 text-gray-900">Success!</h2>
            <p className="text-gray-600 mb-8 font-medium leading-relaxed">
              Tutor Appliction received our team will contact you on your provide contact details
            </p>
            <button 
              onClick={() => window.location.href = '/'}
              className="w-full px-6 py-3 bg-[#B3191F] text-white rounded-md font-bold hover:bg-red-800 transition-colors"
            >
              Okay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}