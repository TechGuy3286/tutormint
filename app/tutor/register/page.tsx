"use client";

import { useState } from "react";

export default function TutorRegisterPage() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    cnic: "",
    teachingMode: "Both",
    preferredApps: [] as string[],
  });

  const appOptions = ["WhatsApp", "Zoom", "Google Meet", "Skype", "Other"];

  const handleAppToggle = (app: string) => {
    setFormData((prev) => {
      const exists = prev.preferredApps.includes(app);
      return {
        ...prev,
        preferredApps: exists
          ? prev.preferredApps.filter((a) => a !== app)
          : [...prev.preferredApps, app],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // Send the data to our new API route
      const response = await fetch('/api/tutor/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Success! Your profile has been created.");
        // Clear the form fields after successful submission
        setFormData({
          fullName: "",
          email: "",
          cnic: "",
          teachingMode: "Both",
          preferredApps: [],
        });
      } else {
        // Show the error (like duplicate email/CNIC)
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      alert("A network error occurred. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Join as a Tutor</h2>
          <p className="text-gray-600 mt-2">
            Create your profile to start connecting with students in Lahore.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-600"
              placeholder="e.g. Ali Raza"
              value={formData.fullName}
              onChange={(e) =>
                setFormData({ ...formData, fullName: e.target.value })
              }
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-600"
              placeholder="ali@example.com"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
            />
          </div>

          {/* CNIC */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CNIC Number (for verification)
            </label>
            <input
              type="text"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-600"
              placeholder="35202-XXXXXXX-X"
              value={formData.cnic}
              onChange={(e) =>
                setFormData({ ...formData, cnic: e.target.value })
              }
            />
          </div>

          {/* Teaching Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Teaching Mode
            </label>
            <div className="grid grid-cols-3 gap-3">
              {["Physical", "Online", "Both"].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFormData({ ...formData, teachingMode: mode })}
                  className={`py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${
                    formData.teachingMode === mode
                      ? "bg-red-600 text-white shadow-sm"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Preferred Apps */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Preferred Online Platforms / Apps
            </label>
            <div className="flex flex-wrap gap-2">
              {appOptions.map((app) => {
                const isSelected = formData.preferredApps.includes(app);
                return (
                  <button
                    key={app}
                    type="button"
                    onClick={() => handleAppToggle(app)}
                    className={`py-2 px-3.5 rounded-lg text-xs font-medium border transition-all ${
                      isSelected
                        ? "border-red-600 bg-red-50 text-red-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {isSelected ? "✓ " : "+ "}
                    {app}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl shadow-md transition-all mt-4"
          >
            Complete Registration
          </button>
        </form>
      </div>
    </div>
  );
}