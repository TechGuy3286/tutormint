"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

// Helper function to render stars based on rating
const renderStars = (rating: number) => {
  if (rating >= 4.9) return "⭐⭐⭐⭐⭐";
  if (rating >= 4.8) return "⭐⭐⭐⭐";
  return "⭐⭐⭐";
};

export default function BrowseTutorsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState("All");
  const [selectedArea, setSelectedArea] = useState("All");
  const [selectedSkill, setSelectedSkill] = useState("All");
  const [selectedGrade, setSelectedGrade] = useState("All");
  const [selectedBudget, setSelectedBudget] = useState("All");

  const supabase = createClient();

  // Async check against actual Supabase session
  const handleProtectedAction = async (actionType: string, tutorData?: any) => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
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
    const matchSearch = searchQuery === "" || 
      tutor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tutor.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tutor.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tutor.area.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tutor.degree.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tutor.grade.toLowerCase().includes(searchQuery.toLowerCase());

    const matchCity = selectedCity === "All" || tutor.city === selectedCity;
    const matchArea = selectedArea === "All" || tutor.area === selectedArea;
    const matchSkill = selectedSkill === "All" || tutor.subject === selectedSkill;
    const matchGrade = selectedGrade === "All" || tutor.grade === selectedGrade;
    
    return matchSearch && matchCity && matchArea && matchSkill && matchGrade;
  });

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#000000] flex flex-col justify-between relative">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 flex-1 w-full">
        
        {/* Page Header & Post Job Button */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#000000]">
              Verified Tutors Feed
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">
              Browse top educators across Pakistan or search keywords below.
            </p>
          </div>
          <button 
            onClick={() => handleProtectedAction("post-job")}
            className="px-5 py-3 bg-[#d60008] hover:bg-[#b50007] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2"
          >
            <span>📋 Post Personalized Job Requirement</span>
          </button>
        </div>

        {/* AI SEARCH BAR */}
        <div className="bg-white p-4 rounded-3xl border border-gray-200 shadow-sm flex items-center gap-3">
          <span className="text-lg pl-2">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="AI Search: Type any keyword (e.g., Mathematics, Lahore, LUMS, Physics)..."
            className="w-full bg-transparent text-xs sm:text-sm font-medium outline-none text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* FEED RESULTS */}
        <div className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-gray-500 px-2">
            Feed Results ({filteredTutors.length})
          </h2>

          <div className="space-y-4">
            {filteredTutors.map((tutor) => (
              <div 
                key={tutor.id} 
                className="bg-white p-5 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6"
              >
                <div className="flex items-start gap-4 w-full sm:w-auto">
                  <div className="flex flex-col items-center space-y-1.5">
                    <img 
                      src={tutor.image} 
                      alt={tutor.name} 
                      className="w-16 h-16 rounded-2xl object-cover border border-gray-200"
                    />
                    <div className="text-[10px] font-bold text-amber-700 whitespace-nowrap">
                      {renderStars(tutor.rating)} ({tutor.reviewCount})
                    </div>
                  </div>

                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-black text-[#000000]">{tutor.name}</h4>
                      <span className="text-[10px] font-extrabold bg-green-100 text-green-900 px-2 py-0.5 rounded-full">
                        ✅ Verified
                      </span>
                    </div>
                    <p className="text-xs font-bold text-[#1f1f7a]">
                      Expert in {tutor.subject} ({tutor.grade})
                    </p>
                    <p className="text-[11px] text-gray-600 font-medium">
                      🎓 {tutor.degree} • 📍 {tutor.area}, {tutor.city}
                    </p>
                  </div>
                </div>

                <div className="w-full sm:w-auto flex-shrink-0">
                  <button 
                    onClick={() => handleProtectedAction("hire", tutor)}
                    className="w-full sm:w-auto px-6 py-3 bg-[#d60008] hover:bg-[#b50007] text-white text-xs font-extrabold rounded-xl text-center shadow-sm transition-all"
                  >
                    Hire / Contact ➔
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}