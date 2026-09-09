'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Layers, GraduationCap } from 'lucide-react'
import { fetchTaxonomyTree, TaxonomyNode } from '@/lib/taxonomy'
import Select from '@/components/forms/Select'

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

  const [subjectSearch, setSubjectSearch] = useState<string>("");

  useEffect(() => {
    async function loadTree() {
      const tree = await fetchTaxonomyTree();
      setTaxonomyTree(tree);
      setLoading(false);
      // NO auto-selection (owner, 10 Sep 2026). The form opens with the level
      // and grade empty so the person actually chooses, and the subjects grid
      // stays hidden until they have. An edit flow still pre-fills both from the
      // saved job via its parent (selectionForMasterIds), which is a real value,
      // not a default.
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

  // The grade is no longer auto-picked. Changing the level resets the grade to
  // empty (the Level select's onChange below), so a stale grade cannot persist,
  // and the custom Select shows its placeholder until the person chooses — the
  // old `<select size={4}>` divergence that forced an auto-pick is gone with it.

  const filteredSubjects = useMemo(() => {
    return availableSubjects.filter((sub: string) => sub.toLowerCase().includes(subjectSearch.toLowerCase()));
  }, [availableSubjects, subjectSearch]);

  if (loading) {
    return <div className="text-xs text-gray-500 py-4">Loading taxonomy structure...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Level — a custom select matching the "Where, how and when" fields. */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-tm-navy block">Level</label>
          <Select
            ariaLabel="Level"
            icon={<Layers size={15} aria-hidden />}
            value={selectedLevel}
            onChange={(v) => {
              setSelectedLevel(v);
              setSelectedGrade('');
              setSelectedSubjects([]);
            }}
            options={levelsList.map((l) => ({ value: l, label: l }))}
            placeholder="Choose a level"
            searchable
          />
        </div>

        {/* Grade — same control; the grade auto-picks when the level changes. */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-tm-navy block">Grade or specialisation</label>
          <Select
            ariaLabel="Grade or specialisation"
            icon={<GraduationCap size={15} aria-hidden />}
            value={selectedGrade}
            onChange={(v) => {
              setSelectedGrade(v);
              setSelectedSubjects([]);
            }}
            options={gradesList.map((g) => ({ value: g, label: g }))}
            placeholder="Choose a grade"
            searchable
            disabled={gradesList.length === 0}
          />
        </div>

      </div>

      {/* Subjects — hidden until a level AND grade are chosen (owner, 10 Sep
          2026). No empty box: one short line stands where the grid will be. */}
      {(!selectedLevel || !selectedGrade) ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-tm-bg p-3 text-[11px] leading-relaxed text-gray-500">
          Choose a level and grade above, and the subjects will appear here.
        </p>
      ) : (
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
      )}
    </div>
  );
}