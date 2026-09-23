// lib/pgFilter.ts
//
// Make a user-typed search term safe to interpolate into a PostgREST `.or()`
// filter string (PR48 §8).
//
// A term like `x,role.eq.admin` dropped into `.or(\`name.ilike.%${term}%,…\`)`
// would be parsed as an extra filter, not as text — PostgREST filter injection.
// It is not SQL injection (the value is still parameterised at the SQL layer)
// and in our code the callers are already privileged admins, but altering a
// filter should not be possible from a search box regardless.
//
// A name / email / title / slug search never needs the characters that carry
// meaning in the PostgREST grammar, so they are stripped: the comma that
// separates conditions, the parentheses that group them, the dot that separates
// column.operator.value, the colon, and the `*`/`\` used in patterns. What is
// left matches exactly what the person typed, minus punctuation they did not
// need. Empty in, empty out.

export function sanitizeOrTerm(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[,()."*:\\%]/g, '')
    .trim()
    .slice(0, 100)
}
