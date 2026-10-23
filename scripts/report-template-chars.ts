// scripts/report-template-chars.ts — READ ONLY. Lists every admin message
// template whose body, title or subject carries a broken character (U+FFFD,
// a lone surrogate, or a C1 control), and every emoji/non-ASCII run in them,
// so a garbled emoji can be traced. Prints template keys and the characters
// around the problem only — templates never hold member data.
//
//   npx tsx --env-file=.env.local scripts/report-template-chars.ts

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

function codes(s: string): string {
  return [...s].map((ch) => 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query<{ key: string; title: string; subject: string | null; body: string }>(
    'select key, title, subject, body from admin_message_templates order by key',
  )
  console.log(`templates: ${rows.length}`)
  for (const r of rows) {
    for (const [field, v] of [['title', r.title], ['subject', r.subject], ['body', r.body]] as const) {
      if (!v) continue
      // Iterate by UTF-16 unit so a lone surrogate is visible.
      for (let i = 0; i < v.length; i++) {
        const u = v.charCodeAt(i)
        const isHigh = u >= 0xd800 && u <= 0xdbff
        const isLow = u >= 0xdc00 && u <= 0xdfff
        const loneHigh = isHigh && !(v.charCodeAt(i + 1) >= 0xdc00 && v.charCodeAt(i + 1) <= 0xdfff)
        const loneLow = isLow && !(v.charCodeAt(i - 1) >= 0xd800 && v.charCodeAt(i - 1) <= 0xdbff)
        if (u === 0xfffd || loneHigh || loneLow || (u >= 0x80 && u <= 0x9f)) {
          console.log(`BROKEN ${r.key}.${field} at ${i}: U+${u.toString(16).toUpperCase()} …${JSON.stringify(v.slice(Math.max(0, i - 30), i + 30))}…`)
        }
      }
      const emoji = v.match(/\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\p{Extended_Pictographic}]*/gu)
      if (emoji) console.log(`emoji  ${r.key}.${field}: ${emoji.map((e: string) => `${e} (${codes(e)})`).join(', ')}`)
    }
  }
  await c.end()
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
