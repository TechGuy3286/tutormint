'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { fetchTaxonomyTree, TaxonomyNode } from '@/lib/taxonomy'

interface TaxonomySelectorProps {
  selectedLevel: string;
  setSelectedLevel: (level: string) => void;
  selectedGrade: string;
  setSelectedGrade: (grade: string) => void;
  selectedSubjects: string[];
  setSelectedSubjects: (subjects: string[]) => void;
}

export default function TaxonomySelector({
  selectedLevel,
  setSelectedLevel,
  selectedGrade,
  setSelectedGrade,
  selectedSubjects,
  setSelectedSubjects
}: TaxonomySelectorProps) {
  const [taxonomyTree, setTaxonomyTree] = useState<TaxonomyNode>({});
  const [loading, setLoading] = useState<boolean>(true);

  const [levelSearch, setLevelSearch] = useState<string>("");
  const [gradeSearch, setGradeSearch] = useState<string>("");
  const [subjectSearch, setSubjectSearch] = useState<string>("");

  useEffect(() => {
    async function loadTree() {
      const tree = await fetchTaxonomyTree();
      setTaxonomyTree(tree);
      setLoading(false);
      const levels = Object.keys(tree);
      if (levels.length > 0 && !selectedLevel) {
        setSelectedLevel(levels[0]);
      }
    }
    loadTree();
  }, []);

  const levelsList = useMemo(() => Object.keys(taxonomyTree), [taxonomyTree]);

  const gradesList = useMemo(() => {
    if (!selectedLevel || !taxonomyTree[selectedLevel]) return [];
    return Object.keys(taxonomyTree[selectedLevel]);
  }, [taxonomyTree, selectedLevel]);

  const availableSubjects = useMemo(() => {
    if (!selectedLevel || !selectedGrade || !taxonomyTree[selectedLevel]?.[selectedGrade]) return [];
    return taxonomyTree[selectedLevel][selectedGrade];
  }, [taxonomyTree, selectedLevel, selectedGrade]);

  const filteredLevels = useMemo(() => {
    return levelsList.filter((lvl: string) => lvl.toLowerCase().includes(levelSearch.toLowerCase()));
  }, [levelsList, levelSearch]);

  const filteredGrades = useMemo(() => {
    return gradesList.filter((grd: string) => grd.toLowerCase().includes(gradeSearch.toLowerCase()));
  }, [gradesList, gradeSearch]);

  const filteredSubjects = useMemo(() => {
    return availableSubjects.filter((sub: string) => sub.toLowerCase().includes(subjectSearch.toLowerCase()));
  }, [availableSubjects, subjectSearch]);

  if (loading) {
    return <div className="text-xs text-gray-500 py-4">Loading taxonomy structure...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        
        {/* Level Selector */}
        <div className="space-y-2 bg-tm-bg p-4 rounded-2xl border border-gray-100">
          <label className="text-xs font-bold text-tm-navy block">📚 Level (Searchable)</label>
          <input 
            type="text"
            placeholder="Search levels..."
            value={levelSearch}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLevelSearch(e.target.value)}
            className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs outline-none mb-2 text-slate-700"
          />
          <select 
            value={selectedLevel} 
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setSelectedLevel(e.target.value);
              setSelectedGrade('');
              setSelectedSubjects([]);
            }}
            className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-tm-navy"
            size={4}
          >
            {filteredLevels.map((lvl: string) => (
              <option key={lvl} value={lvl} className="p-1 rounded">{lvl}</option>
            ))}
          </select>
        </div>

        {/* Grade Selector */}
        <div className="space-y-2 bg-tm-bg p-4 rounded-2xl border border-gray-100">
          <label className="text-xs font-bold text-tm-navy block">🎓 Grade / Specialisation (Searchable)</label>
          <input 
            type="text"
            placeholder="Search grades..."
            value={gradeSearch}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGradeSearch(e.target.value)}
            className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs outline-none mb-2 text-slate-700"
          />
          <select 
            value={selectedGrade} 
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setSelectedGrade(e.target.value);
              setSelectedSubjects([]);
            }}
            className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-tm-navy"
            size={4}
          >
            {filteredGrades.map((grd: string) => (
              <option key={grd} value={grd} className="p-1 rounded">{grd}</option>
            ))}
          </select>
        </div>

      </div>

      {/* Subjects Checkboxes */}
      <div className="space-y-2 bg-tm-bg p-4 rounded-2xl border border-gray-100">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
          <label className="text-xs font-bold text-tm-navy block">📖 Select Subjects</label>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <input 
              type="text"
              placeholder="Search subjects..."
              value={subjectSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubjectSearch(e.target.value)}
              className="p-1.5 px-3 bg-white border border-gray-200 rounded-xl text-xs outline-none flex-1 sm:w-48 text-slate-700"
            />
            <button 
              type="button" 
              onClick={() => {
                if (selectedSubjects.length === availableSubjects.length) {
                  setSelectedSubjects([]);
                } else {
                  setSelectedSubjects([...availableSubjects]);
                }
              }}
              className="inline-flex min-h-[44px] items-center text-[11px] font-extrabold text-tm-red hover:underline whitespace-nowrap cursor-pointer"
            >
              {selectedSubjects.length === availableSubjects.length ? "Deselect All" : "Select All"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-3 bg-white rounded-xl border border-gray-200">
          {filteredSubjects.map((sub: string) => (
            <label key={sub} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-black">
              <input 
                type="checkbox"
                checked={selectedSubjects.includes(sub)}
                onChange={() => {
                  if (selectedSubjects.includes(sub)) {
                    setSelectedSubjects(selectedSubjects.filter((s: string) => s !== sub));
                  } else {
                    setSelectedSubjects([...selectedSubjects, sub]);
                  }
                }}
                className="rounded border-gray-300 text-tm-red focus:ring-0"
              />
              <span className="truncate">{sub}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}