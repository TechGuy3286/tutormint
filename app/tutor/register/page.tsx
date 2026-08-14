"use client";

import { useState } from "react";
import Link from "next/link";

export default function TutorRegistration() {
  const [currentStep, setCurrentStep] = useState(1);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // API wiring will go here in the next step
    console.log("Ready to send to MongoDB:", formData);
    alert("Form architecture ready! Check console for payload.");
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center pt-12 px-4 font-sans text-[#161616]">
      <Link href="/" className="text-3xl font-bold tracking-tight mb-8">
        Tutor<span className="text-[#B3191F]">Mint</span>
      </Link>

      <div className="bg-white max-w-2xl w-full rounded-xl shadow-sm border border-[#EDEDED] p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold mb-2">Join as a Tutor</h1>
          <p className="text-gray-500">Step {currentStep} of 3: Create your nationwide profile.</p>
        </div>

        {/* Tab Indicators */}
        <div className="flex justify-between mb-8 border-b border-gray-200 pb-4">
          {["Identity", "Location & Academics", "Preferences"].map((label, index) => (
            <div 
              key={label} 
              className={`flex-1 text-center font-semibold text-sm ${currentStep === index + 1 ? "text-[#B3191F]" : "text-gray-400"}`}
            >
              {label}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
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
                  <select name="province" value={formData.province} onChange={handleInputChange} className="w-full border border-gray-300 rounded-md p-3 bg-white focus:outline-none focus:border-[#B3191F]">
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
              <button type="button" onClick={prevStep} className="px-6 py-3 border-2 border-gray-300 rounded-md font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                Back
              </button>
            ) : (
              <div></div> // Empty div to keep 'Next' button on the right
            )}
            
            {currentStep < 3 ? (
              <button type="button" onClick={nextStep} className="px-8 py-3 bg-[#161616] text-white rounded-md font-bold hover:bg-gray-800 transition-colors">
                Continue
              </button>
            ) : (
              <button type="submit" className="px-8 py-3 bg-[#B3191F] text-white rounded-md font-bold hover:bg-red-800 transition-colors">
                Submit Application
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}