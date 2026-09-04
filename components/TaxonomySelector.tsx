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
  /** "Select all" bulk toggle. Off for post-a-tuition — nobody posts one
      tuition for every subject. On elsewhere (a tutor may teach many). */
  allowSelectAll?: boolean;
}

export default function TaxonomySelector({
  selectedLevel,
  setSelectedLevel,
  selectedGrade,
  setSelectedGrade,
  selectedSubjects,
  setSelectedSubjects,
  allowSelectAll = true,
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

  /**
   * Keep the grade in state in step with the grade the listbox is DISPLAYING.
   *
   * THE POSTING BLOCKER THIS FIXES. `<select size={4}>` is a listbox, and a
   * listbox whose React `value` is '' matches no <option> -- so the browser
   * selects and renders the FIRST option anyway. Choosing a level calls
   * setSelectedGrade(''), which left every parent looking at a screen that
   * showed "Middle / Lower Secondary" and "Grade 6 to 8" both selected while
   * the component believed no grade was chosen at all. availableSubjects was
   * therefore [], the subject list was empty, and typing "math" filtered an
   * empty array and stayed empty. It happened on a plain page load too,
   * because the mount effect picks a level and nothing picked a grade.
   *
   * No `change` event fires when the browser does this -- nothing
   * user-initiated happened -- so React never finds out on its own. The sync
   * has to be explicit.
   *
   * Selecting the first grade rather than clearing the display is the right
   * way round: the component already auto-picks the first LEVEL on mount, so
   * a parent has every reason to read the grade beside it as chosen too.
   */
  useEffect(() => {
    if (gradesList.length === 0) return
    if (!selectedGrade || !gradesList.includes(selectedGrade)) {
      setSelectedGrade(gradesList[0])
      setSelectedSubjects([])
    }
    // setSelectedGrade / setSelectedSubjects are props and stable in practice;
    // including them re-runs this whenever the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradesList, selectedGrade])

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
        <div className="space-y-2">
          <label className="text-xs font-bold text-tm-navy block">Level</label>
          <input 
            type="text"
            placeholder="Search levels..."
            value={levelSearch}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLevelSearch(e.target.value)}
            className="w-full min-h-[44px] p-2 bg-white border border-gray-200 rounded-xl text-xs outline-none mb-2 text-slate-700"
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
        <div className="space-y-2">
          <label className="text-xs font-bold text-tm-navy block">Grade or specialisation</label>
          <input 
            type="text"
            placeholder="Search grades..."
            value={gradeSearch}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGradeSearch(e.target.value)}
            className="w-full min-h-[44px] p-2 bg-white border border-gray-200 rounded-xl text-xs outline-none mb-2 text-slate-700"
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
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
          <label className="text-xs font-bold text-tm-navy block">Subjects</label>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <input 
              type="text"
              placeholder="Search subjects..."
              value={subjectSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubjectSearch(e.target.value)}
              className="min-h-[44px] p-1.5 px-3 bg-white border border-gray-200 rounded-xl text-xs outline-none flex-1 sm:w-48 text-slate-700"
            />
            {allowSelectAll && (
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
            )}
          </div>
        </div>

        {/* Never silently empty. A blank bordered box is indistinguishable
            from a broken one, and it is what this control did for every
            parent whose grade had gone out of sync -- see the effect above.
            Each empty case says which one it is and what to do next. */}
        {filteredSubjects.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-gray-500">
            {availableSubjects.length === 0
              ? selectedGrade
                ? `${selectedGrade} has no subject list — it is chosen on its own.`
                : 'Choose a level and grade above to see their subjects.'
              : subjectSearch.trim()
                ? `No subjects match “${subjectSearch.trim()}”${selectedGrade ? ` at ${selectedGrade}` : ''} — try another spelling or grade.`
                : 'No subjects to show.'}
          </p>
        ) : (
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
        )}
      </div>
    </div>
  );
}