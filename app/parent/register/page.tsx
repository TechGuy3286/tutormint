"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ParentRegister() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone_number: "",
    city: "",
    studentGrade: "",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/parent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to register. Please try again.");
      }

      setIsSuccess(true);
    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-4 font-sans text-[#161616]">
        <div className="bg-white max-w-lg w-full rounded-xl shadow-sm border border-[#EDEDED] p-10 text-center">
          <div className="text-[#10B981] mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <h2 className="text-3xl font-extrabold mb-4">Registration Successful!</h2>
          <p className="text-gray-600 mb-8">
            Your parent profile has been created. You can now log in to find and connect with verified tutors.
          </p>
          <Link href="/parent/login" className="bg-[#B3191F] text-white px-8 py-3 rounded-md font-bold hover:bg-red-800 transition-colors inline-block">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center pt-12 px-4 font-sans text-[#161616]">
      <Link href="/" className="text-3xl font-bold tracking-tight mb-8">
        Tutor<span className="text-[#B3191F]">Mint</span>
      </Link>

      <div className="bg-white max-w-xl w-full rounded-xl shadow-sm border border-[#EDEDED] p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold mb-2">Parent / Student Registration</h1>
          <p className="text-gray-500">Create your account to hire qualified home or online tutors.</p>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm font-semibold">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Full Name</label>
            <input 
              type="text" 
              name="fullName" 
              value={formData.fullName} 
              onChange={handleInputChange} 
              required 
              className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" 
              placeholder="e.g. Muhammad Ahmed" 
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Email Address</label>
              <input 
                type="email" 
                name="email" 
                value={formData.email} 
                onChange={handleInputChange} 
                required 
                className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" 
                placeholder="ahmed@example.com" 
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Phone Number</label>
              <input 
                type="text" 
                name="phone_number" 
                value={formData.phone_number} 
                onChange={handleInputChange} 
                required 
                className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" 
                placeholder="0300-1234567" 
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">City</label>
              <input 
                type="text" 
                name="city" 
                value={formData.city} 
                onChange={handleInputChange} 
                required 
                className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" 
                placeholder="e.g. Lahore, Karachi" 
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Student Grade / Class</label>
              <input 
                type="text" 
                name="studentGrade" 
                value={formData.studentGrade} 
                onChange={handleInputChange} 
                required 
                className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" 
                placeholder="e.g. 9th Grade, O-Levels" 
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={isSubmitting} 
            className="w-full py-3 bg-[#B3191F] text-white rounded-md font-bold hover:bg-red-800 transition-colors disabled:opacity-50 mt-4"
          >
            {isSubmitting ? "Registering..." : "Register as Parent"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          Already have an account? <Link href="/parent/login" className="text-[#B3191F] font-bold hover:underline">Login here</Link>
        </div>
      </div>
    </div>
  );
}