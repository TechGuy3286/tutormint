// lib/taxonomy.ts
import { createClient } from '@/lib/supabase/client'

export type TaxonomyNode = Record<string, Record<string, string[]>>;

export async function fetchTaxonomyTree(): Promise<TaxonomyNode> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('taxonomy_master')
    .select('"Level 1", "Level 2", "Level 3"')

  if (error) {
    console.error('Error fetching taxonomy tree:', error)
    return {}
  }

  const tree: TaxonomyNode = {}

  data.forEach((row: any) => {
    const l1 = row['Level 1']
    const l2 = row['Level 2']
    const l3 = row['Level 3']

    if (!l1 || !l2) return

    if (!tree[l1]) {
      tree[l1] = {}
    }
    if (!tree[l1][l2]) {
      tree[l1][l2] = []
    }
    if (l3 && !tree[l1][l2].includes(l3)) {
      tree[l1][l2].push(l3)
    }
  })

  return tree
}

export async function fetchLevels(): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('taxonomy_master')
    .select('"Level 1"')

  if (error) {
    console.error('Error fetching levels:', error)
    return []
  }
  const uniqueLevels = Array.from(new Set(data.map((item: any) => item['Level 1']))).filter(Boolean) as string[]
  return uniqueLevels.sort()
}

export async function fetchGradesForLevel(level1: string): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('taxonomy_master')
    .select('"Level 2"')
    .eq('"Level 1"', level1)

  if (error) {
    console.error('Error fetching grades:', error)
    return []
  }
  const uniqueGrades = Array.from(new Set(data.map((item: any) => item['Level 2']))).filter(Boolean) as string[]
  return uniqueGrades.sort()
}

export async function fetchSubjectsForGrade(level1: string, level2: string): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('taxonomy_master')
    .select('"Level 3"')
    .eq('"Level 1"', level1)
    .eq('"Level 2"', level2)

  if (error) {
    console.error('Error fetching subjects:', error)
    return []
  }
  const uniqueSubjects = Array.from(new Set(data.map((item: any) => item['Level 3']))).filter(Boolean) as string[]
  return uniqueSubjects.sort()
}

export async function fetchAllSubjects(): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('taxonomy_master')
    .select('"Level 3"')

  if (error) {
    console.error('Error fetching all subjects:', error)
    return []
  }
  const uniqueSubjects = Array.from(new Set(data.map((item: any) => item['Level 3']))).filter(Boolean) as string[]
  return uniqueSubjects.sort()
}