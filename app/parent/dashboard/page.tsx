"use client";

import { useState } from "react";
import Footer from "@/components/Footer";

// Mock data for tutors with detailed filtering attributes
const allTutors = [
  {
    id: 1,
    name: "Ayesha Khan",
    city: "Lahore",
    area: "Gulberg",
    subject: "Mathematics",
    grade: "10th Class",
    rating: 4.9,
    reviewCount: 24,
    degree: "BS Mathematics (LUMS)",
    mode: "Physical",
    budget: "25,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
  },
  {
    id: 2,
    name: "Muhammad Ali",
    city: "Lahore",
    area: "DHA",
    subject: "Physics",
    grade: "FSc Part 2",
    rating: 4.8,
    reviewCount: 19,
    degree: "BS Computer Science (PU)",
    mode: "Physical",
    budget: "30,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150"
  },
  {
    id: 3,
    name: "Alee Sabeer",
    city: "Karachi",
    area: "Clifton",
    subject: "Computer Science",
    grade: "O-Levels",
    rating: 5.0,
    reviewCount: 32,
    degree: "BS Software Engineering",
    mode: "Online / Physical",
    budget: "35,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150"
  },
  {
    id: 4,
    name: "Amir Sohail",
    city: "Multan",
    area: "Bosan Road",
    subject: "Chemistry",
    grade: "9th Class",
    rating: 4.7,
    reviewCount: 15,
    degree: "MSc Chemistry",
    mode: "Physical",
    budget: "20,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150"
  },
  {
    id: 5,
    name: "Rai Raza",
    city: "Islamabad",
    area: "F-7",
    subject: "English Literature",
    grade: "A-Levels",
    rating: 4.9,
    reviewCount: 28,
    degree: "MA English (NUST)",
    mode: "Online",
    budget: "40,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150"
  },
  {
    id: 6,
    name: "Fatima Noor",
    city: "Lahore",
    area: "Johar Town",
    subject: "Biology",
    grade: "FSc Part 1",
    rating: 4.8,
    reviewCount: 21,
    degree: "MBBS (King Edward)",
    mode: "Physical",
    budget: "28,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150"
  }
];

// Dynamic areas mapping based on selected city
const cityAreasMap: Record<string, string[]> = {
  Lahore: ["Gulberg", "DHA", "Johar Town", "Model Town", "Bahria Town"],
  Karachi: ["Clifton", "DHA", "Gulshan-e-Iqbal", "North Nazimabad"],
  Islamabad: ["F-6", "F-7", "G-8", "Bahria Town"],
  Multan: ["Cantt", "Shah Rukn-e-Alam", "Bosan Road"]
};

export default function BrowseTutorsPage() {
  // Filter States
  const [selectedCity, setSelectedCity] = useState("All");
  const [selectedArea, setSelectedArea] = useState("All");
  const [selectedSkill, setSelectedSkill] = useState("All");
  const [selectedGrade, setSelectedGrade] = useState("All");
  const [selectedRating, setSelectedRating] = useState("All");
  const [selectedBudget, setSelectedBudget] = useState("All");

  // Soft-gate check for actions requiring login/signup
  const handleProtectedAction = (actionType: string, tutorData?: any) => {
    const isLoggedIn = typeof window !== "undefined" && (localStorage.getItem("parentToken") || sessionStorage.getItem("parentData"));

    if (!isLoggedIn) {
      alert("Please log in or sign up to contact or hire tutors.");
      window.location.href = "/parent/login";
      return;
    }

    if (actionType === "hire") {
      window.open(`https://wa.me/923211045245?text=Hi%20I%20want%20to%20hire%20${encodeURIComponent(tutorData.name)}%20for%20${encodeURIComponent(tutorData.subject)}`, "_blank");
    } else if (actionType === "post-job") {
      window.location.href = "/parent/dashboard/post-job";
    }
  };

  // Filter Logic
  const filteredTutors = allTutors.filter((tutor) => {
    const matchCity = selectedCity === "All" || tutor.city === selectedCity;
    const matchArea = selectedArea === "All" || tutor.area === selectedArea;
    const matchSkill = selectedSkill === "All" || tutor.subject === selectedSkill;
    const matchGrade = selectedGrade === "All" || tutor.grade === selectedGrade;
    const matchRating = selectedRating === "All" || tutor.rating >= parseFloat(selectedRating);
    return matchCity && matchArea && matchSkill && matchGrade && matchRating;
  });

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#000000] flex flex-col justify-between relative">
      
      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-8 flex-1 w-full">
        
        {/* Page Header */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#000000]">
              Verified Tutors
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">
              Explore verified educators, ratings, and academic credentials below.
            </p>
          </div>
          <button 
            onClick={() => handleProtectedAction("post-job")}
            className="px-5 py-3 bg-[#d60008] hover:bg-[#b50007] text-white text-xs font-bold rounded-xl shadow-md shadow-[#d60008]/20 transition-all flex items-center gap-2"
          >
            <span>📋 Post Personalized Job Requirement</span>
          </button>
        </div>

        {/* CATEGORIZED FILTER BOXES */}
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-6">
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">
            Advanced Filter Tutors
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            
            {/* 1. Location & Dynamic Area Filter Box */}
            <div className="space-y-2 bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#1f1f7a] block">📍 Location Filter</label>
              <select 
                value={selectedCity} 
                onChange={(e) => {
                  setSelectedCity(e.target.value);
                  setSelectedArea("All");
                }}
                className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#1f1f7a]"
              >
                <option value="All">All Cities (Pakistan)</option>
                <option value="Lahore">Lahore</option>
                <option value="Karachi">Karachi</option>
                <option value="Islamabad">Islamabad</option>
                <option value="Multan">Multan</option>
              </select>

              {selectedCity !== "All" && cityAreasMap[selectedCity] && (
                <select 
                  value={selectedArea}
                  onChange={(e) => setSelectedArea(e.target.value)}
                  className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#1f1f7a] mt-2 animate-in fade-in"
                >
                  <option value="All">All Areas in {selectedCity}</option>
                  {cityAreasMap[selectedCity].map((areaName) => (
                    <option key={areaName} value={areaName}>{areaName}</option>
                  ))}
                </select>
              )}
            </div>

            {/* 2. Skill Wise Filter Box */}
            <div className="space-y-2 bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#1f1f7a] block">📚 Skill / Subject</label>
              <select 
                value={selectedSkill}
                onChange={(e) => setSelectedSkill(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#1f1f7a]"
              >
                <option value="All">All Subjects</option>
                <option value="Mathematics">Mathematics</option>
                <option value="Physics">Physics</option>
                <option value="Computer Science">Computer Science</option>
                <option value="Chemistry">Chemistry</option>
                <option value="English Literature">English Literature</option>
                <option value="Biology">Biology</option>
              </select>
            </div>

            {/* 3. Grade Filter Box */}
            <div className="space-y-2 bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#1f1f7a] block">🎓 Grade / Level</label>
              <select 
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#1f1f7a]"
              >
                <option value="All">All Grades</option>
                <option value="9th Class">9th Class</option>
                <option value="10th Class">10th Class</option>
                <option value="FSc Part 1">FSc Part 1</option>
                <option value="FSc Part 2">FSc Part 2</option>
                <option value="O-Levels">O-Levels</option>
                <option value="A-Levels">A-Levels</option>
              </select>
            </div>

            {/* 4. Rating Wise Filter Box */}
            <div className="space-y-2 bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#1f1f7a] block">⭐ Rating Filter</label>
              <select 
                value={selectedRating}
                onChange={(e) => setSelectedRating(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#1f1f7a]"
              >
                <option value="All">All Ratings</option>
                <option value="4.9">4.9 & above</option>
                <option value="4.8">4.8 & above</option>
                <option value="4.7">4.7 & above</option>
              </select>
            </div>

            {/* 5. Budget / Amount Filter Box */}
            <div className="space-y-2 bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#1f1f7a] block">💰 Budget / Fees</label>
              <select 
                value={selectedBudget}
                onChange={(e) => setSelectedBudget(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#1f1f7a]"
              >
                <option value="All">Any Budget</option>
                <option value="20000">Under 25,000 PKR</option>
                <option value="30000">Under 35,000 PKR</option>
                <option value="40000">Flexible / High</option>
              </select>
            </div>

          </div>
        </div>

        {/* SCROLLABLE TUTORS GRID / LIST */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-2">
            <h2 className="text-sm font-black uppercase tracking-wider text-gray-500">
              Showing Verified Tutors ({filteredTutors.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-h-[800px] overflow-y-auto pr-2">
            {filteredTutors.length > 0 ? (
              filteredTutors.map((tutor) => (
                <div 
                  key={tutor.id} 
                  className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-5"
                >
                  {/* Tutor Header Info */}
                  <div className="flex items-start gap-4">
                    <img 
                      src={tutor.image} 
                      alt={tutor.name} 
                      className="w-14 h-14 rounded-2xl object-cover border border-gray-100 shadow-2xs"
                    />
                    <div className="space-y-1 flex-1">
                      <div className="flex justify-between items-center">
                        <h4 className="text-sm font-black text-[#000000]">{tutor.name}</h4>
                        <span className="text-[10px] font-extrabold bg-[#98FB98]/40 text-[#000000] px-2 py-0.5 rounded-full flex items-center gap-1">
                          🛡️ Verified
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 font-medium">📍 {tutor.area}, {tutor.city}</p>
                    </div>
                  </div>

                  {/* Rating Box */}
                  <div className="bg-amber-50/60 border border-amber-100 p-3 rounded-2xl flex justify-between items-center text-xs">
                    <span className="font-bold text-gray-700">Rating:</span>
                    <span className="font-extrabold text-amber-800">
                      {tutor.rating} / 5.0 ({tutor.reviewCount})
                    </span>
                  </div>

                  {/* Subject & Class Expertise */}
                  <div className="space-y-1.5 text-xs bg-gray-50 p-3 rounded-2xl border border-gray-100">
                    <p className="font-bold text-[#1f1f7a]">
                      Expert in {tutor.subject}
                    </p>
                    <p className="text-gray-600 font-medium">
                      Expert of <span className="font-bold text-gray-900">{tutor.grade}</span>
                    </p>
                    <p className="text-[11px] text-gray-500 pt-1 border-t border-gray-200">
                      Degree: <strong className="text-gray-800">{tutor.degree}</strong>
                    </p>
                  </div>

                  {/* Contact / Hire CTA (Protected Action Gate) */}
                  <button 
                    onClick={() => handleProtectedAction("hire", tutor)}
                    className="w-full py-3 bg-[#d60008] hover:bg-[#b50007] text-white text-xs font-extrabold rounded-xl text-center shadow-sm transition-all flex items-center justify-center gap-2"
                  >
                    <span>Hire / Contact ➔</span>
                  </button>
                </div>
              ))
            ) : (
              <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-gray-200">
                <p className="text-sm font-bold text-gray-500">No tutors found matching your filter criteria.</p>
                <button 
                  onClick={() => {
                    setSelectedCity("All");
                    setSelectedArea("All");
                    setSelectedSkill("All");
                    setSelectedGrade("All");
                    setSelectedRating("All");
                    setSelectedBudget("All");
                  }}
                  className="mt-3 px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl"
                >
                  Reset Filters
                </button>
              </div>
            )}
          </div>
        </div>

      </main>

      {/* Consistent Footer */}
      <Footer />
    </div>
  );
}