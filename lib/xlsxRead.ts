// lib/xlsxRead.ts
//
// A small .xlsx reader: every sheet as a table of plain cells (owner, 11 Oct
// 2026). It exists because PayPro's Orders export is written by a .NET OpenXML
// writer that puts a namespace prefix on every tag (<x:workbook>, <x:sheet>,
// <x:c>…), starts each part with a UTF-8 BOM and uses absolute part paths
// ("/xl/worksheets/sheet.xml"). exceljs matches tag names literally, never sees
// a workbook in such a file, and throws. This reader ignores the prefix, so it
// reads that file and an ordinary Excel-saved one alike.
//
// It reads VALUES only — shared and inline strings, numbers, booleans, cached
// formula results. A number in a date-formatted cell comes back as the ISO day
// (YYYY-MM-DD) it shows in Excel: a calendar day as written, with no time-zone
// shift. No styles, formulas or images are interpreted.

import JSZip from 'jszip'

export type XlsxCell = string | number | boolean | null
export type XlsxSheet = { name: string; rows: XlsxCell[][] }

const MAX_PART_BYTES = 40 * 1024 * 1024

// `<x:name …>` or `<name …>`: the optional prefix is skipped.
const P = '(?:[A-Za-z_][\\w.-]*:)?'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e] ?? m
    })
    // Excel's own escape for control characters: _x000D_
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))
  return m ? decode(m[1] ?? m[2] ?? '') : null
}

/** Every `<tag …>…</tag>` or `<tag …/>` in `xml`: its opening tag and its inside. */
function elements(xml: string, tag: string): { open: string; inner: string }[] {
  const re = new RegExp(`<${P}${tag}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${P}${tag}>)`, 'g')
  const out: { open: string; inner: string }[] = []
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push({ open: m[1] ?? '', inner: m[2] ?? '' })
  return out
}

/** The text of every <t> inside a string item, joined (rich text is several). */
function textOf(inner: string): string {
  // Phonetic guides (<rPh>) are not part of the value.
  const body = inner.replace(new RegExp(`<${P}rPh[\\s\\S]*?</${P}rPh>`, 'g'), '')
  return elements(body, 't')
    .map((t) => decode(t.inner))
    .join('')
}

/** "AB12" → 27 (zero-based column), or -1. */
function columnOf(ref: string | null): number {
  const letters = (ref ?? '').match(/^[A-Za-z]+/)?.[0]
  if (!letters) return -1
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

function isDateFormatCode(code: string): boolean {
  // Drop quoted text, escaped characters and [colour]/[condition] blocks, then
  // look for a day, month or year letter.
  const bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '')
  return /[dmyDMY]/.test(bare) && !/^[#0?.,\sEe+%-]*$/.test(bare)
}

/** Per cell-style index: is it a date format? */
function dateStyles(stylesXml: string | null): boolean[] {
  if (!stylesXml) return []
  const custom = new Map<number, string>()
  for (const f of elements(stylesXml, 'numFmt')) {
    const id = Number(attr(f.open, 'numFmtId'))
    if (Number.isFinite(id)) custom.set(id, attr(f.open, 'formatCode') ?? '')
  }
  const cellXfs = elements(stylesXml, 'cellXfs')[0]
  if (!cellXfs) return []
  return elements(cellXfs.inner, 'xf').map((xf) => {
    const id = Number(attr(xf.open, 'numFmtId') ?? '0')
    const code = custom.get(id)
    return code !== undefined && code !== '' ? isDateFormatCode(code) : BUILT_IN_DATE_FORMATS.has(id)
  })
}

/** Excel serial day → ISO day. `date1904` is the old Mac epoch. */
function serialToIso(serial: number, date1904: boolean): string | null {
  const days = Math.floor(serial) + (date1904 ? 1462 : 0)
  if (!Number.isFinite(days) || days < 1 || days > 2958465) return null
  return new Date(Math.round((days - 25569) * 86_400_000)).toISOString().slice(0, 10)
}

function partPath(target: string, base: string): string {
  const raw = target.startsWith('/') ? target.slice(1) : `${base}${target}`
  const out: string[] = []
  for (const seg of raw.split('/')) {
    if (seg === '..') out.pop()
    else if (seg !== '.' && seg !== '') out.push(seg)
  }
  return out.join('/')
}

/**
 * Read every sheet of an .xlsx file, in workbook order. Throws a plain Error
 * when the bytes are not an .xlsx workbook.
 */
export async function readXlsxSheets(buffer: Buffer | Uint8Array): Promise<XlsxSheet[]> {
  const zip = await JSZip.loadAsync(buffer)
  const lookup = new Map(Object.keys(zip.files).map((n) => [n.toLowerCase(), n]))
  const part = async (path: string): Promise<string | null> => {
    const name = lookup.get(path.toLowerCase())
    const f = name ? zip.file(name) : null
    if (!f) return null
    const text = await f.async('string')
    if (text.length > MAX_PART_BYTES) throw new Error('That workbook is too large to read.')
    return text.replace(/^﻿/, '')
  }

  // The workbook part: named by the package relationships, else the usual place.
  const rootRels = await part('_rels/.rels')
  const office = rootRels ? elements(rootRels, 'Relationship').find((r) => /\/officeDocument$/.test(attr(r.open, 'Type') ?? '')) : undefined
  const workbookPath = office ? partPath(attr(office.open, 'Target') ?? 'xl/workbook.xml', '') : 'xl/workbook.xml'
  const workbook = await part(workbookPath)
  if (!workbook) throw new Error('This file is not an Excel workbook.')
  const base = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1) : ''
  const relsPath = `${base}_rels/${workbookPath.slice(base.length)}.rels`
  const rels = (await part(relsPath)) ?? ''

  const targets = new Map<string, { target: string; type: string }>()
  for (const r of elements(rels, 'Relationship')) {
    const id = attr(r.open, 'Id')
    if (id) targets.set(id, { target: partPath(attr(r.open, 'Target') ?? '', base), type: attr(r.open, 'Type') ?? '' })
  }
  const byType = (suffix: string) => [...targets.values()].find((t) => t.type.endsWith(suffix))?.target

  const sharedXml = await part(byType('/sharedStrings') ?? `${base}sharedStrings.xml`)
  const shared = sharedXml ? elements(sharedXml, 'si').map((si) => textOf(si.inner)) : []
  const isDate = dateStyles(await part(byType('/styles') ?? `${base}styles.xml`))
  const date1904 = /^(1|true)$/i.test(attr(elements(workbook, 'workbookPr')[0]?.open ?? '', 'date1904') ?? '')

  const sheets: XlsxSheet[] = []
  for (const s of elements(workbook, 'sheet')) {
    const name = attr(s.open, 'name') ?? ''
    // r:id — the relationship prefix varies too.
    const rid = s.open.match(/(?:^|\s)(?:[A-Za-z_][\w.-]*:)?id\s*=\s*"([^"]*)"/)?.[1]
    const target = rid ? targets.get(rid)?.target : undefined
    const xml = target ? await part(target) : null
    if (xml === null) continue

    const rows: XlsxCell[][] = []
    for (const row of elements(xml, 'row')) {
      const cells: XlsxCell[] = []
      let next = 0
      for (const c of elements(row.inner, 'c')) {
        const at = columnOf(attr(c.open, 'r'))
        const col = at >= 0 ? at : next
        next = col + 1
        const type = attr(c.open, 't') ?? 'n'
        const v = elements(c.inner, 'v')[0]
        const raw = v ? decode(v.inner) : null
        let value: XlsxCell = null
        if (type === 'inlineStr') value = textOf(elements(c.inner, 'is')[0]?.inner ?? '')
        else if (raw === null || raw === '') value = null
        else if (type === 's') value = shared[Number(raw)] ?? null
        else if (type === 'str') value = raw
        else if (type === 'b') value = raw === '1' || raw.toLowerCase() === 'true'
        else if (type === 'e') value = null
        else if (type === 'd') value = raw.slice(0, 10)
        else {
          const n = Number(raw)
          if (!Number.isFinite(n)) value = raw
          else value = isDate[Number(attr(c.open, 's') ?? '0')] ? (serialToIso(n, date1904) ?? n) : n
        }
        while (cells.length < col) cells.push(null)
        cells[col] = value
      }
      rows.push(cells)
    }
    sheets.push({ name, rows })
  }
  if (sheets.length === 0) throw new Error('This workbook has no sheets we could read.')
  return sheets
}
