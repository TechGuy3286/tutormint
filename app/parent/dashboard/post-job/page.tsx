"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Full Taxonomy Hierarchy loaded from Spreadsheet
const taxonomyData: Record<string, Record<string, string[]>> = {
  "ADP  (2 Years)": {
    "All": [
      "English", "Urdu", "Pakistan Studies", "Islamiyat / Islamic Studies", "Translation of the Holy Quran", 
      "Ethics / Religious Education", "Mathematics", "Statistics", "Computer Science", "Information Technology / ICT", 
      "Physics", "Chemistry", "Biology", "Economics", "Accounting", "Finance", "Business Studies", "Management", 
      "Marketing", "Human Resource Management", "Entrepreneurship", "Commerce", "Education", "Psychology", "Sociology", 
      "Political Science", "International Relations", "History", "Geography", "English Literature", "English Language & Linguistics", 
      "Arabic", "Punjabi", "Mass Communication", "Journalism", "Library & Information Science", "Social Work", 
      "Public Administration", "Environmental Science", "Physical Education", "Fine Arts", "Home Economics", "Agriculture", 
      "Food Science & Technology", "Botany", "Zoology", "Microbiology", "Biotechnology", "Geology", "Computer Programming", 
      "Database Management", "Web Development", "Graphic Design", "Digital Marketing", "Data Science", "Artificial Intelligence", 
      "Cyber Security", "Business Analytics", "Supply Chain Management", "Project Management", "Banking & Finance", 
      "Islamic Banking & Finance", "Tourism & Hospitality Management", "Special Education", "Early Childhood Education", 
      "Public Health", "Human Nutrition & Dietetics"
    ]
  },
  "BS (4 Years)": {
    "Semester 1 - 8": [
      "English", "Urdu", "Pakistan Studies", "Islamiyat / Islamic Studies", "Translation of the Holy Quran", 
      "Ethics / Religious Education", "Mathematics", "Statistics", "Computer Science", "Information Technology", 
      "Artificial Intelligence", "Data Science", "Cyber Security", "Software Engineering", "Information Systems", 
      "Computer Engineering", "Electrical Engineering", "Electronics Engineering", "Mechanical Engineering", "Civil Engineering", 
      "Chemical Engineering", "Biomedical Engineering", "Environmental Engineering", "Architecture", "Accounting", "Finance", 
      "Banking & Finance", "Business Administration", "Business Analytics", "Marketing", "Human Resource Management", 
      "Entrepreneurship", "Supply Chain Management", "Project Management", "Economics", "Commerce", "Education", 
      "Early Childhood Education", "Elementary Education", "Secondary Education", "Special Education", "Educational Leadership & Management", 
      "Psychology", "Applied Psychology", "Sociology", "Social Work", "Political Science", "International Relations", 
      "Public Administration", "Law", "History", "Geography", "English Literature", "English Language & Linguistics", 
      "Urdu Literature", "Arabic", "Punjabi", "Persian", "Mass Communication", "Journalism", "Media Studies", 
      "Development Studies", "Peace & Conflict Studies", "Environmental Science", "Environmental Studies", "Biology", 
      "Botany", "Zoology", "Microbiology", "Biotechnology", "Biochemistry", "Chemistry", "Physics", "Applied Mathematics", 
      "Geology", "Agriculture", "Agronomy", "Horticulture", "Food Science & Technology", "Food & Nutrition", 
      "Human Nutrition & Dietetics", "Public Health", "Pharmacy", "Nursing", "Allied Health Sciences", "Medical Laboratory Technology", 
      "Physiotherapy", "Physical Education", "Sports Sciences", "Fine Arts", "Visual Arts", "Graphic Design", "Fashion Design", 
      "Textile Design", "Interior Design", "Design & Technology", "Tourism & Hospitality Management", "Hotel Management", 
      "Aviation Management", "Library & Information Science", "Environmental Management", "Media & Communication", "Film & Television", 
      "Theatre & Performing Arts", "Music", "Islamic Banking & Finance", "Islamic Economics", "Actuarial Science", "Operations Research", 
      "Blockchain Technology", "Cloud Computing", "Web Development", "Mobile Application Development", "Game Development", 
      "Digital Marketing", "E-Commerce", "FinTech", "Renewable Energy", "Energy Engineering", "Telecommunication Engineering", 
      "Mechatronics Engineering", "Robotics Engineering"
    ]
  },
  "Holy Quran": {
    "Semester1-6": [
      "Nazra Quran", "Hifzul Quran", "Translation of Quran"
    ]
  },
  "IB": {
    "PYP, MYP and Diploma": [
      "Language", "Social Studies", "Mathematics", "Science", "Arts", "Personal, Social & Physical Education", 
      "Language & Literature", "Language Acquisition", "Individuals & Societies", "Sciences", "Physical & Health Education", 
      "Design", "Language A: Literature", "Language A: Language & Literature", "Literature & Performance", "Language B", 
      "Language ab initio", "Classical Languages", "Business Management", "Digital Society", "Economics", "Geography", 
      "Global Politics", "History", "Philosophy", "Psychology", "Social & Cultural Anthropology", "World Religions", 
      "Biology", "Chemistry", "Computer Science", "Design Technology", "Environmental Systems & Societies", "Physics", 
      "Sports, Exercise & Health Science", "Mathematics: Analysis & Approaches", "Mathematics: Applications & Interpretation", 
      "Dance", "Film", "Music", "Theatre", "Visual Arts", "Theory of Knowledge", "Extended Essay", "Creativity, Activity, Service"
    ]
  },
  "IGCSE": {
    "IGCSE Core": [
      "English", "Mathematics", "Biology", "Chemistry", "Physics", "Combined Science", "Co-ordinated Sciences", 
      "Computer Science", "ICT", "Pakistan Studies", "Islamiyat", "Urdu", "Accounting", "Business Studies", "Economics", 
      "Geography", "History", "Sociology", "Environmental Management", "Art & Design", "Design & Technology", 
      "Physical Education", "Literature in English", "Global Perspectives", "Arabic"
    ],
    "O Levels": [
      "English Language", "Literature in English", "Mathematics", "Additional Mathematics", "Biology", "Chemistry", 
      "Physics", "Combined Science", "Environmental Management", "Accounting", "Business Studies", "Economics", "Commerce", 
      "Computer Science", "Statistics", "Geography", "History", "Sociology", "Global Perspectives", "Pakistan Studies", 
      "Islamiyat", "Islamic Studies", "Arabic", "Urdu as a First Language", "Urdu as a Second Language", "Art & Design", 
      "Food & Nutrition", "Fashion & Textiles", "Travel & Tourism", "Physical Education", "Agriculture", "Bangladesh Studies", 
      "Bengali", "Sinhala", "Tamil", "Biblical Studies"
    ],
    "AS & ALevels": [
      "Accounting", "Arabic", "Art & Design", "Biblical Studies", "Biology", "Business", "Chemistry", "Chinese Language", 
      "Chinese Language & Literature", "Classical Studies", "Computer Science", "Design & Technology", "Digital Media & Design", 
      "Drama", "Economics", "English Language", "English Language & Literature", "English Literature", "English General Paper", 
      "Environmental Management", "European History", "French Language", "French Language & Literature", "Geography", 
      "German Language", "German Language & Literature", "Global Perspectives & Research", "History", "Hinduism", 
      "Information Technology", "International History", "Islamic Studies", "Law", "Marine Science", "Mathematics", 
      "Further Mathematics", "Media Studies", "Music", "Physics", "Portuguese", "Psychology", "Sociology", "Spanish Language", 
      "Spanish Language & Literature", "Sport & Physical Education", "Tamil", "Thinking Skills", "Travel & Tourism", "Urdu", 
      "Urdu Language & Literature", "Urdu – Pakistan", "US History", "Statistics", "Environmental Science", "Economics & Business", 
      "Pakistan Studies", "Religious Studies"
    ]
  },
  "Intermediate": {
    "FA ( Part I & Part II)": [
      "English", "Urdu", "Islamic Education / Islamiat", "Pakistan Studies", "Translation of the Holy Quran", 
      "Ethics / Religious Education", "History", "History of Islam", "History of Muslim India", "History of Pakistan", 
      "History of the Modern World", "Economics", "Geography", "Civics", "Philosophy", "Psychology", "Sociology", 
      "Statistics", "Islamic Studies", "Education", "Home Economics", "Outlines of Home Economics", "Fine Arts", "Music", 
      "Arabic", "Persian", "Punjabi", "Sindhi", "Pashto", "Saraiki", "Urdu Advance", "English Elective", "French", 
      "German", "Health & Physical Education", "Military Science", "Geology", "Library Science", "Computer Science", 
      "Computer Science & Entrepreneurship", "Mathematics", "Agriculture", "Nursing", "Commercial Practices", "Applied Art", 
      "Food & Nutrition", "Child Development & Family Living", "Clothing & Textile", "Entrepreneurship", "General Science", 
      "Information Technology / ICT", "Media Studies", "Environmental Studies"
    ],
    "FSC Part I & Part II": [
      "English", "Urdu", "Islamiyat / Islamic Studies", "Pakistan Studies", "Translation of the Holy Quran", 
      "Ethics / Religious Education", "Physics", "Chemistry", "Biology", "Mathematics", "Statistics", "Economics", 
      "Computer Science", "Computer Science & Entrepreneurship", "General Science", "Information Technology / ICT", 
      "Environmental Science", "Geology", "Agriculture", "Health & Physical Education", "Physical Education", "Library Science"
    ]
  },
  "MS / MPhil": {
    "Semester1-6": [
      "English", "English Literature", "English Language & Linguistics", "Urdu", "Punjabi", "Arabic", "Persian", 
      "Islamic Studies", "Quranic Studies", "Hadith Studies", "Comparative Religion", "Education", "Educational Leadership & Management", 
      "Teacher Education", "Early Childhood Education", "Special Education", "Educational Psychology", "Curriculum & Instruction", 
      "Educational Technology", "Educational Planning & Management", "Psychology", "Clinical Psychology", "Applied Psychology", 
      "Sociology", "Social Work", "Political Science", "International Relations", "Public Administration", "History", 
      "Geography", "Pakistan Studies", "Economics", "Commerce", "Business Administration", "Management Sciences", "Marketing", 
      "Finance", "Accounting", "Human Resource Management", "Entrepreneurship", "Supply Chain Management", "Business Analytics", 
      "Computer Science", "Information Technology", "Software Engineering", "Artificial Intelligence", "Data Science", 
      "Cyber Security", "Information Systems", "Mathematics", "Applied Mathematics", "Statistics", "Physics", "Chemistry", 
      "Biochemistry", "Biology", "Botany", "Zoology", "Microbiology", "Biotechnology", "Environmental Science", 
      "Environmental Management", "Geology", "Food Science & Technology", "Food & Nutrition", "Human Nutrition & Dietetics", 
      "Agriculture", "Agronomy", "Horticulture", "Plant Sciences", "Animal Sciences", "Veterinary Sciences", "Public Health", 
      "Epidemiology", "Pharmacy", "Pharmaceutical Sciences", "Pharmacology", "Medical Laboratory Sciences", "Physiotherapy", 
      "Physical Education", "Sports Sciences", "Fine Arts", "Visual Arts", "Art & Design", "Graphic Design", "Media Studies", 
      "Mass Communication", "Journalism", "Film & Television", "Library & Information Science", "Development Studies", 
      "Peace & Conflict Studies", "Gender Studies", "International Development", "Defence & Strategic Studies", "Defence Studies", 
      "Law", "Criminology", "Anthropology", "Archaeology", "Philosophy", "Economics & Finance", "Islamic Economics", 
      "Islamic Banking & Finance", "Islamic Finance", "Actuarial Science", "Data Analytics", "Artificial Intelligence & Robotics", 
      "Renewable Energy", "Energy Studies", "Climate Change", "Biotechnology & Genetic Engineering", "Molecular Biology", 
      "Genetics", "Bioinformatics", "Neuroscience", "Nanotechnology", "Materials Science", "Computational Physics", 
      "Computational Mathematics", "Computational Biology", "Remote Sensing & GIS", "Tourism & Hospitality Management", 
      "International Business", "Project Management", "Operations Management", "Organizational Psychology", "Organizational Behavior", 
      "Leadership & Management"
    ]
  },
  "Matriculation": {
    "Grade 9 & 10 - Arts": [
      "English", "Urdu", "Mathematics", "Islamiyat / Islamic Studies", "Pakistan Studies", "General Science", 
      "Economics", "Civics", "Education", "History", "Geography", "Arabic", "Persian", "Punjabi", "Home Economics", 
      "Fine Arts", "Drawing", "Computer Science", "Information Technology", "Physical Education", "Health & Physical Education", 
      "Additional Mathematics"
    ],
    "Grade 9 & 10 - Science": [
      "English", "Urdu", "Mathematics", "Physics", "Chemistry", "Biology", "Computer Science", "Islamiyat / Islamic Studies", 
      "Pakistan Studies", "General Science", "Translation of the Holy Quran", "Nazra Quran", "Quran Studies", "Arabic", 
      "Punjabi", "Sindhi", "Pashto", "Balochi", "Ethics", "Religious Education", "Information Technology", "ICT", 
      "Additional Mathematics", "General Mathematics"
    ]
  },
  "Middle / Lower Secondary": {
    "Grade-6, Grade-7, and Grade-8": [
      "English", "Urdu", "Mathematics", "General Science", "Computer Science", "Islamiat / Islamic Studies", 
      "Quran Studies / Translation of Holy Quran", "Ethics / Religious Education", "History", "Geography", "Social Studies", 
      "Regional Language", "Arabic", "Persian", "Punjabi", "Sindhi", "Pashto", "Balochi", "Brahui", "English Grammar", 
      "English Literature", "Creative Writing", "Communication Skills", "General Knowledge", "Environmental Studies", 
      "Environmental Education", "Health & Physical Education", "Physical Education", "Art & Drawing", "Fine Arts", 
      "Home Economics", "Agriculture", "Technology", "Information Technology / ICT", "Digital Literacy", "Coding", 
      "Programming", "STEM", "Robotics", "Artificial Intelligence", "Electronics", "Science Projects", "Entrepreneurship", 
      "Financial Literacy", "Life Skills", "Character & Moral Education", "Personal Development", "Drama & Performing Arts", 
      "Music", "Craft", "Library / Reading", "Study Skills", "Public Speaking", "Handwriting"
    ]
  },
  "Pre - Primary / Pre - School": {
    "Pre Nursery / Play Group / KG - I": [
      "English", "Urdu", "Mathematics", "Phonics", "Pre-Reading", "Pre-Writing", "Vocabulary", "Communication Skills", 
      "General Knowledge", "World Around Us", "Science", "Environmental Awareness", "Islamic Studies / Islamiat", 
      "Nazra Quran", "Quran Studies", "Mother Tongue / Regional Language", "Health & Hygiene", "Safety Education", 
      "Social & Emotional Development", "Moral & Character Education", "Computer Skills", "Digital Literacy", "STEM", 
      "Coding", "Robotics", "Art & Drawing", "Creative Arts", "Craft", "Music", "Rhymes & Action Songs", "Drama & Role Play", 
      "Physical Education", "Montessori Activities", "Sensory Learning"
    ]
  },
  "Primary": {
    "Grade-1, Grade-2, Grade-3,Grade-4 and Grade-5": [
      "English", "Urdu", "Mathematics", "General Science", "General Knowledge", "Social Studies", "Islamiat / Islamic Studies", 
      "Quran Studies", "Nazra Quran", "Quran Translation", "Ethics / Religious Education", "Arabic", "Punjabi", "Sindhi", 
      "Pashto", "Balochi", "Brahui", "Computer Science", "Information Technology / ICT", "Digital Literacy", "Coding", 
      "Programming", "STEM", "Robotics", "Artificial Intelligence", "Environmental Studies", "Art & Drawing", "Fine Arts", 
      "Craft", "Music", "Drama & Performing Arts", "Physical Education", "Health Education", "Sports", "Life Skills"
    ]
  },
  "Sports & Games": {
    "Semester1-6": [
      "Chess", "Ludo", "Carrom", "Scrabble", "Rubik's Cube", "Darts", "Table Tennis", "Badminton", "Basketball Skills", 
      "Football Skills", "Cricket Skills", "Tennis Skills", "Hockey Skills", "Futsal Skills", "Volleyball Skills", "Athletics", 
      "Running", "Fitness Training", "Physical Fitness", "Yoga", "Gymnastics", "Skipping", "Cycling", "Roller Skating", 
      "Skating", "Karate", "Taekwondo", "Judo", "Martial Arts", "Self-Defense", "Boxing Fitness", "Wrestling", "Archery", 
      "Dance", "Ballet", "Swimming Theory & Dry Training", "Sports Skills Development", "Motor Skills Development", 
      "Coordination Training", "Balance Training", "Agility Training", "Speed & Reaction Training", "Strength & Conditioning", 
      "Endurance Training", "Sports Fitness", "Sports Psychology", "Sports Strategy & Tactics", "Referee & Rules Training", 
      "E-Sports", "Gaming Skills", "Mind Games", "Board Games"
    ]
  },
  "Test Preparations": {
    "Semester 1 - 8": [
      "GRE Preparation", "GMAT Preparation", "IELTS Preparation", "TOEFL Preparation", "PTE Academic Preparation", 
      "MDCAT Preparation", "ECAT Preparation", "NET Preparation", "FAST-NU Admission Test Preparation", "GIKI Admission Test Preparation", 
      "COMSATS Admission Test Preparation", "LUMS Admission Test Preparation", "NTS Test Preparation", "NAT Preparation", 
      "GAT General Preparation", "GAT Subject Preparation", "ETEA Test Preparation", "ECAT Engineering Entry Test Preparation", 
      "University Admission Test Preparation", "Medical Entry Test Preparation", "Engineering Entry Test Preparation", 
      "Law Admission Test (LAT) Preparation", "Law GAT Preparation", "CSS Preparation", "PMS Preparation", "FPSC Test Preparation", 
      "PPSC Test Preparation", "SPSC Test Preparation", "KPPSC Test Preparation", "BPSC Test Preparation", "AJKPSC Test Preparation", 
      "NTS Recruitment Test Preparation", "FPSC Competitive Exam Preparation", "Police Recruitment Test Preparation", 
      "Armed Forces Test Preparation", "ISSB Preparation", "Pakistan Army Initial Test Preparation", "Pakistan Navy Test Preparation", 
      "Pakistan Air Force Test Preparation", "Cadet College Entry Test Preparation", "Military College Entry Test Preparation", 
      "Scholarship Test Preparation", "School Admission Test Preparation", "College Admission Test Preparation", 
      "University Entrance Test Preparation", "English Proficiency Test Preparation", "General Aptitude Test Preparation", 
      "Verbal Reasoning", "Quantitative Reasoning", "Logical Reasoning", "Analytical Reasoning", "Non-Verbal Reasoning", 
      "IQ Test Preparation", "General Knowledge Test Preparation", "Current Affairs Test Preparation", "Subject Specialist Test Preparation", 
      "Teaching Recruitment Test Preparation", "Educator Test Preparation", "Banking Test Preparation", "Accounting & Finance Test Preparation", 
      "Computer-Based Test Preparation", "Typing Test Preparation", "Driving License Test Preparation", "Vocational Test Preparation"
    ]
  }
};

const cityAreasMap: Record<string, string[]> = {
  Lahore: ["Gulberg", "DHA", "Johar Town", "Model Town", "Bahria Town"],
  Karachi: ["Clifton", "DHA", "Gulshan-e-Iqbal", "North Nazimabad"],
  Islamabad: ["F-6", "F-7", "G-8", "Bahria Town"],
  Multan: ["Cantt", "Shah Rukn-e-Alam", "Bosan Road"]
};

const allAvailableTutors = [
  {
    id: 1,
    name: "Ayesha Khan",
    city: "Lahore",
    area: "Gulberg",
    subject: "Mathematics",
    grade: "Grade 9 & 10 - Science",
    gender: "Female",
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
    grade: "FSC Part I & Part II",
    gender: "Male",
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
    grade: "O Levels",
    gender: "Male",
    rating: 5.0,
    reviewCount: 32,
    degree: "BS Software Engineering",
    mode: "Online / Physical",
    budget: "35,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150"
  }
];

export default function PostJobPage() {
  const levelsList = Object.keys(taxonomyData);

  const [levelSearch, setLevelSearch] = useState("");
  const [gradeSearch, setGradeSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");

  const [selectedLevel, setSelectedLevel] = useState("Matriculation");
  const gradesList = Object.keys(taxonomyData[selectedLevel] || {});
  const [selectedGrade, setSelectedGrade] = useState(gradesList[0] || "");
  
  const availableSubjects = taxonomyData[selectedLevel]?.[selectedGrade] || [];
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);

  const [selectedCity, setSelectedCity] = useState("Lahore");
  const [selectedArea, setSelectedArea] = useState("Gulberg");
  const [tuitionTime, setTuitionTime] = useState("05:00 PM");
  const [preferredGender, setPreferredGender] = useState("No Preference");

  const [aiTitle, setAiTitle] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [aiSkills, setAiSkills] = useState("");
  const [isGenerated, setIsGenerated] = useState(false);
  const [matchedTutors, setMatchedTutors] = useState<any[]>([]);

  const supabase = createClient();

  // Restore saved session data on page load (e.g. after returning from login)
  useEffect(() => {
    const savedSession = sessionStorage.getItem('savedJobSession');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        if (parsed.selectedLevel) setSelectedLevel(parsed.selectedLevel);
        if (parsed.selectedGrade) setSelectedGrade(parsed.selectedGrade);
        if (parsed.selectedSubjects) setSelectedSubjects(parsed.selectedSubjects);
        if (parsed.selectedCity) setSelectedCity(parsed.selectedCity);
        if (parsed.selectedArea) setSelectedArea(parsed.selectedArea);
        if (parsed.tuitionTime) setTuitionTime(parsed.tuitionTime);
        if (parsed.preferredGender) setPreferredGender(parsed.preferredGender);
        if (parsed.aiTitle) setAiTitle(parsed.aiTitle);
        if (parsed.aiDescription) setAiDescription(parsed.aiDescription);
        if (parsed.aiSkills) setAiSkills(parsed.aiSkills);
        if (parsed.matchedTutors) setMatchedTutors(parsed.matchedTutors);
        if (parsed.isGenerated) setIsGenerated(parsed.isGenerated);

        sessionStorage.removeItem('savedJobSession');
      } catch (err) {
        console.error("Error restoring session:", err);
      }
    }
  }, []);

  const filteredLevels = useMemo(() => {
    return levelsList.filter(lvl => lvl.toLowerCase().includes(levelSearch.toLowerCase()));
  }, [levelSearch, levelsList]);

  const filteredGrades = useMemo(() => {
    return gradesList.filter(grd => grd.toLowerCase().includes(gradeSearch.toLowerCase()));
  }, [gradeSearch, gradesList]);

  const filteredSubjects = useMemo(() => {
    return availableSubjects.filter(sub => sub.toLowerCase().includes(subjectSearch.toLowerCase()));
  }, [subjectSearch, availableSubjects]);

  const handleSubjectToggle = (sub: string) => {
    if (sub === "All") {
      if (selectedSubjects.length === availableSubjects.length) {
        setSelectedSubjects([]);
      } else {
        setSelectedSubjects([...availableSubjects]);
      }
      return;
    }

    if (selectedSubjects.includes(sub)) {
      setSelectedSubjects(selectedSubjects.filter(s => s !== sub));
    } else {
      setSelectedSubjects([...selectedSubjects, sub]);
    }
  };

  const handleGenerateAIJob = (e: React.FormEvent) => {
    e.preventDefault();
    const subsText = selectedSubjects.length > 0 ? selectedSubjects.join(", ") : "General Subjects";
    
    const generatedTitle = `Required Expert Tutor for ${selectedGrade} (${selectedLevel}) - ${subsText}`;
    const generatedDesc = `Looking for an experienced and camera-verified home tutor in ${selectedArea}, ${selectedCity}. Sessions required around ${tuitionTime}. Focus on conceptual clarity, past papers, and structured study plans.`;
    const generatedSkillsList = `${subsText}, ${selectedGrade} Expertise, Communication Skills`;

    setAiTitle(generatedTitle);
    setAiDescription(generatedDesc);
    setAiSkills(generatedSkillsList);
    setIsGenerated(true);

    const results = allAvailableTutors.filter((t) => {
      const matchCity = t.city.toLowerCase() === selectedCity.toLowerCase();
      const matchGender = preferredGender === "No Preference" || t.gender.toLowerCase() === preferredGender.toLowerCase();
      return matchCity && matchGender;
    });

    setMatchedTutors(results);
  };

  // Real Database Insertion with Auth & Session Backup
  const handlePublishJob = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Save current session payload before redirecting to login
        const sessionPayload = {
          selectedLevel,
          selectedGrade,
          selectedSubjects,
          selectedCity,
          selectedArea,
          tuitionTime,
          preferredGender,
          aiTitle,
          aiDescription,
          aiSkills,
          matchedTutors,
          isGenerated
        };
        sessionStorage.setItem('savedJobSession', JSON.stringify(sessionPayload));
        
        alert("🔒 Please log in to publish your job. Your selected filters and generated job preview have been safely saved!");
        window.location.href = "/parent/login?redirect=/parent/dashboard/post-job";
        return;
      }

      const jobTxId = `JOB-TRK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      const { error } = await supabase.from('parent_jobs').insert({
        parent_id: user.id,
        job_tx_id: jobTxId,
        title: aiTitle,
        description: aiDescription,
        subject: selectedSubjects.join(", ") || "General",
        grade: selectedGrade,
        city: selectedCity,
        area: selectedArea,
        budget: "25,000 PKR / mo",
        status: "Active"
      });

      if (error) throw error;

      alert("🎉 Job published successfully! Matching verified tutors have been notified.");
      window.location.href = "/parent/dashboard";
    } catch (err: any) {
      alert(`Error publishing job: ${err.message}`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 font-sans text-[#334155]">
      
      {/* TOP PANEL */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#0F172A]">
            Post Personalized Job Requirement
          </h1>
          <p className="text-xs sm:text-sm text-gray-600 font-medium">
            Configure academic taxonomy and schedule filters below. Our AI will instantly draft your listing and match top educators.
          </p>
        </div>
        <Link 
          href="/parent/dashboard" 
          className="px-4 py-2.5 bg-[#F8FAFC] hover:bg-gray-200 text-[#334155] text-xs font-bold rounded-xl border border-gray-200 transition-colors"
        >
          ← Back to Feed
        </Link>
      </div>

      {/* FILTER BUILDER FORM */}
      <form onSubmit={handleGenerateAIJob} className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
        
        <div className="space-y-4">
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 border-b border-gray-100 pb-3">
            Section 1: Academic Taxonomy (Searchable Level ➔ Grade ➔ Subjects)
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            <div className="space-y-2 bg-[#F8FAFC] p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#0F172A] block">📚 Level (Searchable)</label>
              <input 
                type="text"
                placeholder="Search levels..."
                value={levelSearch}
                onChange={(e) => setLevelSearch(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs outline-none mb-2 text-[#334155]"
              />
              <select 
                value={selectedLevel} 
                onChange={(e) => {
                  const newLevel = e.target.value;
                  setSelectedLevel(newLevel);
                  const newGrades = Object.keys(taxonomyData[newLevel] || {});
                  setSelectedGrade(newGrades[0] || "");
                  setSelectedSubjects([]);
                }}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#0F172A]"
                size={4}
              >
                {filteredLevels.map((lvl) => (
                  <option key={lvl} value={lvl} className="p-1 rounded">{lvl}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2 bg-[#F8FAFC] p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#0F172A] block">🎓 Grade / Specialisation (Searchable)</label>
              <input 
                type="text"
                placeholder="Search grades..."
                value={gradeSearch}
                onChange={(e) => setGradeSearch(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs outline-none mb-2 text-[#334155]"
              />
              <select 
                value={selectedGrade} 
                onChange={(e) => {
                  setSelectedGrade(e.target.value);
                  setSelectedSubjects([]);
                }}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#0F172A]"
                size={4}
              >
                {filteredGrades.map((grd) => (
                  <option key={grd} value={grd} className="p-1 rounded">{grd}</option>
                ))}
              </select>
            </div>

          </div>

          <div className="space-y-2 bg-[#F8FAFC] p-4 rounded-2xl border border-gray-100">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
              <label className="text-xs font-bold text-[#0F172A] block">📖 Select Subjects</label>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <input 
                  type="text"
                  placeholder="Search subjects..."
                  value={subjectSearch}
                  onChange={(e) => setSubjectSearch(e.target.value)}
                  className="p-1.5 px-3 bg-white border border-gray-200 rounded-xl text-xs outline-none flex-1 sm:w-48 text-[#334155]"
                />
                <button 
                  type="button" 
                  onClick={() => handleSubjectToggle("All")}
                  className="text-[11px] font-extrabold text-[#d60008] hover:underline whitespace-nowrap"
                >
                  {selectedSubjects.length === availableSubjects.length ? "Deselect All" : "Select All"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-3 bg-white rounded-xl border border-gray-200">
              {filteredSubjects.map((sub) => (
                <label key={sub} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-black">
                  <input 
                    type="checkbox"
                    checked={selectedSubjects.includes(sub)}
                    onChange={() => handleSubjectToggle(sub)}
                    className="rounded border-gray-300 text-[#d60008] focus:ring-0"
                  />
                  <span className="truncate">{sub}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 border-b border-gray-100 pb-3">
            Section 2: Location, Time & Preferences
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            
            <div className="space-y-2 bg-[#F8FAFC] p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#0F172A] block">📍 City</label>
              <select 
                value={selectedCity} 
                onChange={(e) => {
                  setSelectedCity(e.target.value);
                  const areas = cityAreasMap[e.target.value] || ["Gulberg"];
                  setSelectedArea(areas[0]);
                }}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#0F172A]"
              >
                {Object.keys(cityAreasMap).map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2 bg-[#F8FAFC] p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#0F172A] block">🏘️ Area</label>
              <select 
                value={selectedArea} 
                onChange={(e) => setSelectedArea(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#0F172A]"
              >
                {(cityAreasMap[selectedCity] || ["Gulberg"]).map((area) => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2 bg-[#F8FAFC] p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#0F172A] block">⏰ Tuition Time</label>
              <select 
                value={tuitionTime} 
                onChange={(e) => setTuitionTime(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#0F172A]"
              >
                <option value="03:00 PM">03:00 PM</option>
                <option value="04:00 PM">04:00 PM</option>
                <option value="05:00 PM">05:00 PM</option>
                <option value="06:00 PM">06:00 PM</option>
                <option value="08:00 PM">08:00 PM</option>
                <option value="10:00 PM">10:00 PM</option>
              </select>
            </div>

            <div className="space-y-2 bg-[#F8FAFC] p-4 rounded-2xl border border-gray-100">
              <label className="text-xs font-bold text-[#0F172A] block">👤 Preferred Gender</label>
              <select 
                value={preferredGender} 
                onChange={(e) => setPreferredGender(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#0F172A]"
              >
                <option value="No Preference">No Preference</option>
                <option value="Male">Male Tutor</option>
                <option value="Female">Female Tutor</option>
              </select>
            </div>

          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button 
            type="submit"
            className="px-6 py-3 bg-[#d60008] hover:bg-red-700 text-white text-xs font-extrabold rounded-xl shadow-md transition-all flex items-center gap-2"
          >
            <span>✨ Generate AI Job Post & Find Tutors</span>
          </button>
        </div>
      </form>

      {isGenerated && (
        <div className="space-y-6 animate-in fade-in duration-300">
          
          <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-3xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-black uppercase tracking-wider text-emerald-900">
                🤖 AI-Generated Job Post Preview
              </h3>
              <button 
                type="button"
                onClick={handlePublishJob}
                className="px-5 py-2.5 bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
              >
                Publish Job Requirement 🚀
              </button>
            </div>

            <div className="space-y-2 bg-white p-4 rounded-2xl border border-emerald-100 text-xs">
              <div><span className="text-gray-400 font-bold uppercase text-[10px]">Title:</span> <strong className="text-gray-900 text-sm">{aiTitle}</strong></div>
              <div><span className="text-gray-400 font-bold uppercase text-[10px]">Description:</span> <p className="text-gray-700 mt-0.5">{aiDescription}</p></div>
              <div><span className="text-gray-400 font-bold uppercase text-[10px]">Required Skills:</span> <span className="font-semibold text-[#059669]">{aiSkills}</span></div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-500 px-2">
              Instant AI-Matched Tutors ({matchedTutors.length})
            </h3>

            <div className="space-y-4">
              {matchedTutors.length > 0 ? (
                matchedTutors.map((tutor) => (
                  <div 
                    key={tutor.id} 
                    className="bg-white p-5 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6"
                  >
                    <div className="flex items-start gap-4 w-full sm:w-auto">
                      <img src={tutor.image} alt={tutor.name} className="w-16 h-16 rounded-2xl object-cover border border-gray-200" />
                      <div className="space-y-1.5 flex-1">
                        <h4 className="text-sm font-black text-[#0F172A]">{tutor.name}</h4>
                        <p className="text-xs font-bold text-[#059669]">Expert in {tutor.subject} ({tutor.grade}) • Gender: {tutor.gender}</p>
                        <p className="text-[11px] text-gray-600 font-medium">🎓 {tutor.degree} • 📍 {tutor.area}, {tutor.city} • Time Slot: {tuitionTime}</p>
                      </div>
                    </div>
                    <a 
                      href={`https://wa.me/923211045245?text=Hi%20I%20want%20to%20hire%20${encodeURIComponent(tutor.name)}%20for%20${encodeURIComponent(tutor.subject)}`} 
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-6 py-3 bg-[#d60008] hover:bg-red-700 text-white text-xs font-extrabold rounded-xl text-center shadow-sm block"
                    >
                      Hire / Contact ➔
                    </a>
                  </div>
                ))
              ) : (
                <div className="p-8 bg-white rounded-3xl border border-gray-200 text-center text-xs font-bold text-gray-500">
                  No exact matching tutors found for this specific location. Publish your job requirement so tutors can apply directly!
                </div>
              )}
            </div>
          </div>

        </div>
      )}

    </div>
  );
}