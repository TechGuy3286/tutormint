'use client'

import { matchSubject, useSubjectWords } from '@/lib/searchWords'
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Check, Layers, X } from 'lucide-react'
import { fetchCoreTree, fetchNoGradeLevels, fetchTaxonomyTree, TaxonomyNode } from '@/lib/taxonomy'
import { orderSubjectsForPicker } from '@/lib/taxonomyBuild'
import Select from '@/components/forms/Select'
import { onOutsidePointerDown } from '@/lib/outsidePointer'
import { TextLinesSkeleton } from '@/components/Skeletons'
import { clearGrade, selectAllForGrade, toggleGradeSubject, type GradeSubjectMap } from '@/lib/gradeSubjects'

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
  /** Item 17 (post a tuition): instead of one "Select all" for every subject,
      each selected grade gets its own "Main subjects" / "Clear all" chips that
      touch only that grade's subjects. */
  perGradeBulk?: boolean;
  /** Item 2 (owner, 7 Oct 2026): with perGradeBulk, each grade keeps its OWN
      subject list here (grade → subject names). The caller keeps
      selectedSubjects as the union. */
  gradeSubjects?: GradeSubjectMap;
  setGradeSubjects?: (map: GradeSubjectMap) => void;
}

export default function TaxonomySelector({
  selectedLevel,
  setSelectedLevel,
  selectedGrades,
  setSelectedGrades,
  selectedSubjects,
  setSelectedSubjects,
  allowSelectAll = true,
  perGradeBulk = false,
  gradeSubjects,
  setGradeSubjects,
}: TaxonomySelectorProps) {
  const subjectWords = useSubjectWords()
  const perGrade = perGradeBulk && !!gradeSubjects && !!setGradeSubjects;
  const [taxonomyTree, setTaxonomyTree] = useState<TaxonomyNode>({});
  // Main subjects per level (migration 146), for the per-grade "Main subjects" chip.
  const [coreTree, setCoreTree] = useState<TaxonomyNode>({});
  // Levels with NO grade step (migration 153, e.g. Admission Test Prep).
  const [noGrade, setNoGrade] = useState<string[]>([]);
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
      const [tree, core, ng] = await Promise.all([fetchTaxonomyTree(), fetchCoreTree(), fetchNoGradeLevels()]);
      setTaxonomyTree(tree);
      setCoreTree(core);
      setNoGrade(ng);
      setLoading(false);
      // NO auto-selection (owner, 10 Sep 2026): the form opens empty so the
      // person chooses. An edit flow pre-fills from selectionForMasterIds.
    }
    loadTree();
  }, []);

  const levelsList = useMemo(() => Object.keys(taxonomyTree), [taxonomyTree]);

  // The grades for the chosen category. The tree carries only the CURRENT
  // (non-legacy) taxonomy — migration 80 hides retired grades from it at the
  // source — so every key here is a live pick; no legacy filtering is needed.
  const gradesList = useMemo(() => {
    if (!selectedLevel || !taxonomyTree[selectedLevel]) return [];
    return Object.keys(taxonomyTree[selectedLevel]);
  }, [taxonomyTree, selectedLevel]);

  // A no-grade level carries ONE implicit grade: it is selected for the person
  // and the grade selector is not shown at all (no "None" option). Saving is
  // then valid with no grade chosen by hand, for this level only.
  const isNoGrade = !!selectedLevel && noGrade.includes(selectedLevel);
  useEffect(() => {
    if (loading || !isNoGrade || gradesList.length === 0) return;
    const same =
      selectedGrades.length === gradesList.length && gradesList.every((g) => selectedGrades.includes(g));
    if (!same) setSelectedGrades([...gradesList]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isNoGrade, gradesList]);

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
    return orderSubjectsForPicker(Array.from(set), selectedLevel, noGrade);
  }, [taxonomyTree, selectedLevel, selectedGrades, noGrade]);

  // Once the tree is loaded, drop any selected subject no longer offered by the
  // chosen grades (a grade was unticked). Guarded so it never fires while the
  // tree is still loading — that would wipe an edit pre-fill.
  useEffect(() => {
    if (loading || selectedGrades.length === 0 || perGrade) return;
    const keep = selectedSubjects.filter((s) => availableSubjects.includes(s));
    if (keep.length !== selectedSubjects.length) setSelectedSubjects(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSubjects, loading]);

  const filteredSubjects = useMemo(() => {
    return availableSubjects.filter((sub: string) => matchSubject(subjectSearch, sub, subjectWords));
  }, [availableSubjects, subjectSearch]);

  const toggleGrade = (g: string) => {
    if (selectedGrades.includes(g)) setSelectedGrades(selectedGrades.filter((x) => x !== g));
    else setSelectedGrades([...selectedGrades, g]);
  };

  // "Select all grades in this level" (owner PR64 §B2): pick every grade the
  // chosen level offers in one tap, or clear them.
  const allGradesSelected =
    gradesList.length > 0 && gradesList.every((g) => selectedGrades.includes(g));
  const toggleAllGrades = () => setSelectedGrades(allGradesSelected ? [] : [...gradesList]);

  if (loading) {
    return <div className="py-4"><TextLinesSkeleton lines={3} /></div>;
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
      {selectedLevel && !isNoGrade && (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <label className="text-xs font-bold text-tm-navy block">Grade or specialisation</label>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              {gradesList.length > 6 && (
                <input
                  type="text"
                  placeholder="Search grades..."
                  value={gradeSearch}
                  onChange={(e) => setGradeSearch(e.target.value)}
                  className="min-h-[44px] p-1.5 px-3 bg-white border border-gray-200 rounded-xl text-xs outline-none flex-1 sm:w-48 text-slate-700"
                />
              )}
              {allowSelectAll && gradesList.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllGrades}
                  className="inline-flex min-h-[44px] items-center text-[11px] font-extrabold text-tm-red hover:underline whitespace-nowrap cursor-pointer"
                >
                  {allGradesSelected ? 'Deselect all grades' : 'Select all grades'}
                </button>
              )}
            </div>
          </div>

          {/* PR106-G5 §2.7: grades appear ONCE — as tappable chips (no duplicate
              checkbox list, no separate selected-chip row). Selected = light
              green + tick + deep-green border. Selected grades stay visible even
              while a search filters the rest. */}
          {Array.from(new Set([...selectedGrades, ...gradesFiltered])).length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-gray-500">
              {gradesList.length === 0
                ? 'This level has no grades to choose.'
                : `No grades match “${gradeSearch.trim()}” — try another spelling.`}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
              {Array.from(new Set([...selectedGrades, ...gradesFiltered])).map((g) => {
                const on = selectedGrades.includes(g)
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGrade(g)}
                    className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition-colors cursor-pointer ${on ? 'border-tm-green-deep bg-tm-tint-green text-tm-green-deep' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'}`}
                  >
                    {on && <Check size={13} aria-hidden />}
                    <span className="max-w-[12rem] truncate">{g}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Subjects — hidden until a level AND at least one grade are chosen. */}
      {(!selectedLevel || selectedGrades.length === 0) ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-tm-bg p-3 text-[11px] leading-relaxed text-gray-500">
          {isNoGrade
            ? 'The choices for this level will appear here.'
            : 'Choose a level and grade above, and the subjects will appear here.'}
        </p>
      ) : perGrade ? (
        <PerGradeSubjects
          grades={selectedGrades}
          offered={taxonomyTree[selectedLevel] ?? {}}
          core={coreTree[selectedLevel] ?? {}}
          map={gradeSubjects!}
          setMap={setGradeSubjects!}
          hideGradeName={isNoGrade}
        />
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
            {allowSelectAll && !perGrade && availableSubjects.length > 0 && (
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

/**
 * Subjects PER GRADE (owner, 7 Oct 2026). Each selected grade has its own list:
 * its own search box, its own chips, its own "Main subjects" / "Clear all". Tapping
 * a chip toggles it for that grade only; other grades are untouched.
 */
function PerGradeSubjects({
  grades,
  offered,
  core,
  map,
  setMap,
  hideGradeName = false,
}: {
  grades: string[]
  offered: Record<string, string[]>
  /** Each grade's MAIN subjects; a grade with none hides its chip. */
  core: Record<string, string[]>
  map: GradeSubjectMap
  setMap: (m: GradeSubjectMap) => void
  /** A no-grade level (migration 153): its one implicit grade is never named. */
  hideGradeName?: boolean
}) {
  const subjectWords = useSubjectWords()
  const [search, setSearch] = useState<Record<string, string>>({})
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-tm-navy">{hideGradeName ? 'Subjects' : 'Subjects for each grade'}</p>
      {grades.map((g) => {
        const list = offered[g] ?? []
        const chosen = map[g] ?? []
        const q = (search[g] ?? '').trim().toLowerCase()
        const shown = list.filter((s) => matchSubject(q, s, subjectWords))
        // "Main subjects" adds THIS grade's core subjects (migration 146) — only
        // ones the grade offers — and is hidden when the grade has none.
        const main = (core[g] ?? []).filter((s) => list.includes(s))
        const mainAdded = main.length > 0 && main.every((s) => chosen.includes(s))
        return (
          <section key={g} aria-label={`Subjects for ${g}`} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-black text-tm-navy">
                {hideGradeName ? 'Choose' : g}
                <span className="ms-1.5 font-semibold text-gray-500">· {chosen.length} chosen</span>
              </p>
              <div className="flex gap-2">
                {main.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMap(selectAllForGrade(map, g, main))}
                    disabled={mainAdded}
                    aria-label={`Add the main subjects for ${g}`}
                    className="inline-flex min-h-[36px] items-center rounded-full border border-tm-green-deep bg-tm-tint-green px-3 text-[11px] font-bold text-tm-green-deep disabled:opacity-60 cursor-pointer"
                  >
                    Main subjects
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMap(clearGrade(map, g))}
                  disabled={chosen.length === 0}
                  aria-label={`Clear all subjects for ${g}`}
                  className="inline-flex min-h-[36px] items-center rounded-full border border-gray-200 bg-white px-3 text-[11px] font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60 cursor-pointer"
                >
                  Clear all
                </button>
              </div>
            </div>
            {list.length > 8 && (
              <input
                type="text"
                placeholder={`Search ${g} subjects...`}
                value={search[g] ?? ''}
                onChange={(e) => setSearch({ ...search, [g]: e.target.value })}
                className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs text-slate-700 outline-none"
              />
            )}
            {list.length === 0 ? (
              <p className="text-[11px] text-gray-500">This grade has no subject list.</p>
            ) : shown.length === 0 ? (
              <p className="text-[11px] text-gray-500">No subjects match &ldquo;{search[g]}&rdquo; for {g}.</p>
            ) : (
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {shown.map((s) => {
                  const on = chosen.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setMap(toggleGradeSubject(map, g, s))}
                      className={`inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 text-[11px] font-bold cursor-pointer ${on ? 'border-tm-green-deep bg-tm-tint-green text-tm-green-deep' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'}`}
                    >
                      {on && <Check size={12} aria-hidden />}
                      <span className="max-w-[12rem] truncate">{s}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {list.length > 0 && chosen.length === 0 && (
              <p className="text-[11px] text-gray-500">{hideGradeName ? 'Choose at least one.' : `Choose at least one subject for ${g}.`}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
