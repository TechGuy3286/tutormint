'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Layers, X } from 'lucide-react'
import { fetchTaxonomyTree, fetchLegacyLevelNames, TaxonomyNode } from '@/lib/taxonomy'
import Select from '@/components/forms/Select'
import { onOutsidePointerDown } from '@/lib/outsidePointer'

interface TaxonomySelectorProps {
  selectedLevel: string;
  setSelectedLevel: (level: string) => void;
  /** MULTI-SELECT grade/level (migration 79). A job or tutor picks any number. */
  selectedGrades: string[];
  setSelectedGrades: (grades: string[]) => void;
  selectedSubjects: string[];
  setSelectedSubjects: (subjects: string[]) => void;
  /** "Select all" bulk toggle. Off for post-a-tuition — nobody posts one
      tuition for every subject. On elsewhere (a tutor may teach many). */
  allowSelectAll?: boolean;
}

export default function TaxonomySelector({
  selectedLevel,
  setSelectedLevel,
  selectedGrades,
  setSelectedGrades,
  selectedSubjects,
  setSelectedSubjects,
  allowSelectAll = true,
}: TaxonomySelectorProps) {
  const [taxonomyTree, setTaxonomyTree] = useState<TaxonomyNode>({});
  const [legacyLevels, setLegacyLevels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(true);

  const [gradeSearch, setGradeSearch] = useState<string>("");
  const [subjectSearch, setSubjectSearch] = useState<string>("");

  // Once the person interacts OUTSIDE the selector, the subjects grid collapses
  // to its red-chip summary and reopens on a click (same as before the split).
  const rootRef = useRef<HTMLDivElement>(null);
  const [subjectsCollapsed, setSubjectsCollapsed] = useState<boolean>(false);

  useEffect(() => {
    if (subjectsCollapsed || selectedSubjects.length === 0) return;
    return onOutsidePointerDown(document, () => rootRef.current, () =>
      setSubjectsCollapsed(true),
    );
  }, [subjectsCollapsed, selectedSubjects.length]);

  useEffect(() => {
    if (selectedSubjects.length === 0) setSubjectsCollapsed(false);
  }, [selectedSubjects.length]);

  useEffect(() => {
    async function loadTree() {
      const [tree, legacy] = await Promise.all([fetchTaxonomyTree(), fetchLegacyLevelNames()]);
      setTaxonomyTree(tree);
      setLegacyLevels(legacy);
      setLoading(false);
      // NO auto-selection (owner, 10 Sep 2026): the form opens empty so the
      // person chooses. An edit flow pre-fills from selectionForMasterIds.
    }
    loadTree();
  }, []);

  const levelsList = useMemo(() => Object.keys(taxonomyTree), [taxonomyTree]);

  // The grades for the chosen category. A split-away LEGACY level (migration 79)
  // is hidden — UNLESS it is already selected (an existing row being edited), so
  // the person sees their current pick and can keep or re-pick it.
  const gradesList = useMemo(() => {
    if (!selectedLevel || !taxonomyTree[selectedLevel]) return [];
    return Object.keys(taxonomyTree[selectedLevel]).filter(
      (g) => !legacyLevels.has(g) || selectedGrades.includes(g),
    );
  }, [taxonomyTree, selectedLevel, legacyLevels, selectedGrades]);

  const gradesFiltered = useMemo(
    () => gradesList.filter((g) => g.toLowerCase().includes(gradeSearch.toLowerCase())),
    [gradesList, gradeSearch],
  );

  // Subjects available across EVERY selected grade (deduped, sorted).
  const availableSubjects = useMemo(() => {
    if (!selectedLevel || selectedGrades.length === 0) return [] as string[];
    const set = new Set<string>();
    for (const g of selectedGrades) {
      for (const s of taxonomyTree[selectedLevel]?.[g] ?? []) set.add(s);
    }
    return Array.from(set).sort();
  }, [taxonomyTree, selectedLevel, selectedGrades]);

  // Once the tree is loaded, drop any selected subject no longer offered by the
  // chosen grades (a grade was unticked). Guarded so it never fires while the
  // tree is still loading — that would wipe an edit pre-fill.
  useEffect(() => {
    if (loading || selectedGrades.length === 0) return;
    const keep = selectedSubjects.filter((s) => availableSubjects.includes(s));
    if (keep.length !== selectedSubjects.length) setSelectedSubjects(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSubjects, loading]);

  const filteredSubjects = useMemo(() => {
    return availableSubjects.filter((sub: string) => sub.toLowerCase().includes(subjectSearch.toLowerCase()));
  }, [availableSubjects, subjectSearch]);

  const toggleGrade = (g: string) => {
    if (selectedGrades.includes(g)) setSelectedGrades(selectedGrades.filter((x) => x !== g));
    else setSelectedGrades([...selectedGrades, g]);
  };

  if (loading) {
    return <div className="text-xs text-gray-500 py-4">Loading taxonomy structure...</div>;
  }

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Level (category) — a custom single-select, as before. */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-tm-navy block">Level</label>
        <Select
          ariaLabel="Level"
          icon={<Layers size={15} aria-hidden />}
          value={selectedLevel}
          onChange={(v) => {
            setSelectedLevel(v);
            setSelectedGrades([]);
            setSelectedSubjects([]);
          }}
          options={levelsList.map((l) => ({ value: l, label: l }))}
          placeholder="Choose a level"
          searchable
        />
      </div>

      {/* Grade or specialisation — MULTI-SELECT now (owner, 11 Sep 2026). Search
          + checkbox grid + chips, the same shape as subjects, so the larger
          split set stays searchable and reads cleanly at 360px. */}
      {selectedLevel && (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <label className="text-xs font-bold text-tm-navy block">Grade or specialisation</label>
            {gradesList.length > 6 && (
              <input
                type="text"
                placeholder="Search grades..."
                value={gradeSearch}
                onChange={(e) => setGradeSearch(e.target.value)}
                className="min-h-[44px] p-1.5 px-3 bg-white border border-gray-200 rounded-xl text-xs outline-none w-full sm:w-48 text-slate-700"
              />
            )}
          </div>

          {selectedGrades.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedGrades.map((g) => (
                <span
                  key={g}
                  className="inline-flex items-center gap-1 rounded-full bg-tm-red py-1 pl-2.5 pr-1 text-[11px] font-semibold text-white"
                >
                  <span className="max-w-[12rem] truncate">{g}</span>
                  <button
                    type="button"
                    onClick={() => toggleGrade(g)}
                    aria-label={`Remove ${g}`}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-white/25 cursor-pointer"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}

          {gradesFiltered.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-gray-500">
              {gradesList.length === 0
                ? 'This level has no grades to choose.'
                : `No grades match “${gradeSearch.trim()}” — try another spelling.`}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-3 bg-white rounded-xl border border-gray-200">
              {gradesFiltered.map((g) => (
                <label key={g} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedGrades.includes(g)}
                    onChange={() => toggleGrade(g)}
                    className="rounded border-gray-300 text-tm-red focus:ring-0"
                  />
                  <span className="truncate">{g}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Subjects — hidden until a level AND at least one grade are chosen. */}
      {(!selectedLevel || selectedGrades.length === 0) ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-tm-bg p-3 text-[11px] leading-relaxed text-gray-500">
          Choose a level and grade above, and the subjects will appear here.
        </p>
      ) : (
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
          <label className="text-xs font-bold text-tm-navy block">Subjects</label>
          {subjectsCollapsed ? (
            <button
              type="button"
              onClick={() => setSubjectsCollapsed(false)}
              className="inline-flex min-h-[44px] items-center text-[11px] font-extrabold text-tm-red hover:underline cursor-pointer"
            >
              Change
            </button>
          ) : (
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <input
              type="text"
              placeholder="Search subjects..."
              value={subjectSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubjectSearch(e.target.value)}
              className="min-h-[44px] p-1.5 px-3 bg-white border border-gray-200 rounded-xl text-xs outline-none flex-1 sm:w-48 text-slate-700"
            />
            {allowSelectAll && availableSubjects.length > 0 && (
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
          )}
        </div>

        {selectedSubjects.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedSubjects.map((sub: string) => (
              <span
                key={sub}
                className="inline-flex items-center gap-1 rounded-full bg-tm-red py-1 pl-2.5 pr-1 text-[11px] font-semibold text-white"
              >
                <span className="max-w-[10rem] truncate">{sub}</span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSubjects(selectedSubjects.filter((s: string) => s !== sub))
                  }
                  aria-label={`Remove ${sub}`}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-white/25 cursor-pointer"
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        {!subjectsCollapsed &&
          (filteredSubjects.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-gray-500">
            {availableSubjects.length === 0
              ? 'These grades have no subject list — they are chosen on their own.'
              : subjectSearch.trim()
                ? `No subjects match “${subjectSearch.trim()}” — try another spelling or grade.`
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
        ))}
      </div>
      )}
    </div>
  );
}
