// lib/taxonomySeed.ts
//
// Pure parser for the owner's authoritative taxonomy dataset
// (supabase/seed/taxonomy-2026.csv), columns: level, grade, subject.
//
// "level" is the top tier (a taxonomy_category), "grade" the middle tier (a
// taxonomy_level), "subject" the leaf. The dataset is loaded VERBATIM — this
// parser never renames, reorders, merges or de-duplicates a name; it only groups
// the flat rows into the three-tier shape and preserves first-seen order so the
// pickers read in the file's own order. Shared by the migration generator
// (scripts/build-taxonomy-2026.ts) and the test (scripts/test-taxonomy.ts) so the
// SQL and the assertions read the exact same rows.

/** One (level, grade, subject) triple, verbatim from the CSV. */
export type TaxonomyRow = { level: string; grade: string; subject: string }

export type TaxonomyGrade = { name: string; subjects: string[] }
export type TaxonomyLevel = { name: string; grades: TaxonomyGrade[] }

export type ParsedTaxonomy = {
  rows: TaxonomyRow[]
  /** Levels in first-seen order; each grade's subjects in first-seen order. */
  levels: TaxonomyLevel[]
  /** Distinct subject names across the whole file, first-seen order. */
  subjects: string[]
}

/**
 * Parse a single CSV line into fields, honouring double-quoted fields that
 * contain commas ("Personal, Social & Physical Education") and doubled quotes.
 * The dataset uses only comma quoting; no embedded newlines.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}

/** Parse the whole CSV text (including the header row) into the tiered shape. */
export function parseTaxonomyCsv(text: string): ParsedTaxonomy {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const rows: TaxonomyRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    if (i === 0) {
      // header: level,grade,subject — assert shape, then skip
      if (cells[0].trim().toLowerCase() !== 'level') {
        throw new Error(`Unexpected header: ${lines[0]}`)
      }
      continue
    }
    if (cells.length < 3) throw new Error(`Row ${i + 1} has ${cells.length} fields: ${lines[i]}`)
    const level = cells[0]
    const grade = cells[1]
    const subject = cells.slice(2).join(',') // defensive: subject is the last field
    if (!level || !grade || !subject) throw new Error(`Row ${i + 1} has an empty field: ${lines[i]}`)
    rows.push({ level, grade, subject })
  }

  const levels: TaxonomyLevel[] = []
  const levelByName = new Map<string, TaxonomyLevel>()
  const subjects: string[] = []
  const subjectSeen = new Set<string>()

  for (const r of rows) {
    let lvl = levelByName.get(r.level)
    if (!lvl) {
      lvl = { name: r.level, grades: [] }
      levelByName.set(r.level, lvl)
      levels.push(lvl)
    }
    let grade = lvl.grades.find((g) => g.name === r.grade)
    if (!grade) {
      grade = { name: r.grade, subjects: [] }
      lvl.grades.push(grade)
    }
    if (!grade.subjects.includes(r.subject)) grade.subjects.push(r.subject)
    if (!subjectSeen.has(r.subject)) {
      subjectSeen.add(r.subject)
      subjects.push(r.subject)
    }
  }

  return { rows, levels, subjects }
}
