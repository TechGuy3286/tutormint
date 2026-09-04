// lib/markdown.ts
//
// A small, deliberately constrained Markdown renderer for blog post bodies.
//
// WHY NOT A LIBRARY. The output is public HTML, so it has to be safe against
// injection even though the authors are trusted admins (owner/manager publish;
// support can only draft). The cheapest way to be safe is to control the output
// entirely: every character of source text is HTML-escaped FIRST, and the only
// tags in the result are ones this file emits from a fixed whitelist. There is
// no path by which source text becomes a tag, so there is no XSS to sanitise
// away afterwards -- which is what a general Markdown+sanitiser pair would be
// spending two dependencies to achieve.
//
// WHAT IT SUPPORTS. Headings (## -> h2, ### and deeper -> h3; a bare # is
// treated as h2 because the PAGE owns the single h1), paragraphs, bold, italic,
// inline code, fenced code, links, images, unordered and ordered lists,
// blockquotes, horizontal rules -- and the embed blocks below.
//
// EMBEDS. A line that is exactly `{{tutor:some-slug}}` or `{{job:some-slug}}`
// becomes a live card, rendered by the page from real data. The parser returns
// the body as an ordered list of segments so the page can splice React nodes
// (the cards) between runs of rendered HTML. A subject or city the author wants
// to link goes through the landing helper via the post's related-pages picker,
// not by scanning prose -- a mislinked auto-detected word is worse than none.
//
// HEADING IDS drive the table of contents, so they are produced in the same
// pass as the HTML and returned alongside it -- one source of truth for "what
// headings exist and what anchor does each have".

import { slugify } from '@/lib/slugs'

export type Embed = { type: 'tutor' | 'job'; slug: string }
export type MarkdownSegment = { kind: 'html'; html: string } | { kind: 'embed'; embed: Embed }
export type Heading = { id: string; text: string; level: 2 | 3 }

export type ParsedPost = {
  segments: MarkdownSegment[]
  headings: Heading[]
  /** Whole-minutes reading time, floored at 1. */
  readingTime: number
}

const EMBED_RE = /^\{\{(tutor|job):([a-z0-9][a-z0-9-]*)\}\}$/
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/
const UL_RE = /^\s*[-*]\s+(.+)$/
const OL_RE = /^\s*\d+\.\s+(.+)$/
const BLOCKQUOTE_RE = /^>\s?(.*)$/
// A GFM pipe table: a header row of `|`-separated cells followed by a delimiter
// row of dashes (with optional alignment colons). Cells are escaped and run
// through inline() like everything else, so a table cannot become a tag any
// more than a paragraph can.
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/

/** True when line `i` opens a table (a header row above a delimiter row). */
function isTableStart(lines: string[], i: number): boolean {
  return (
    i + 1 < lines.length &&
    lines[i].includes('|') &&
    TABLE_DELIM_RE.test(lines[i + 1]) &&
    lines[i].trim() !== ''
  )
}

/** Split a `|`-delimited row into trimmed cell strings, dropping outer pipes. */
function tableCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

// A sentinel that HTML-escaped source text can never contain, used to stash
// finished inline spans while emphasis is applied around them. Written as an
// escape so the SOURCE file holds no control byte.
const SENTINEL = '\u0000'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A safe href. Only http(s), mailto, and site-relative paths are allowed;
 * anything else (javascript:, data:, a bare word) is dropped and the link
 * renders as plain text. The input arrives already HTML-escaped.
 */
function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (!href) return null
  if (href.startsWith('/') || href.startsWith('#')) return href
  if (/^https?:\/\//i.test(href)) return href
  if (/^mailto:[^\s]+@[^\s]+$/i.test(href)) return href
  return null
}

/** Inline formatting on an already-escaped string. */
function inline(escaped: string): string {
  const stash: string[] = []
  const keep = (html: string): string => {
    stash.push(html)
    return `${SENTINEL}${stash.length - 1}${SENTINEL}`
  }

  let s = escaped

  // Inline code first, so * and _ inside it are not treated as emphasis.
  s = s.replace(/`([^`]+)`/g, (_m, code) => keep(`<code>${code}</code>`))

  // Images before links (the syntaxes share brackets).
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => {
    const href = safeHref(url)
    if (!href) return alt
    return keep(`<img src="${href}" alt="${alt}" loading="lazy" />`)
  })

  // Links.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    const href = safeHref(url)
    if (!href) return text
    const external = /^https?:\/\//i.test(href)
    const rel = external ? ' target="_blank" rel="noopener nofollow"' : ''
    return keep(`<a href="${href}"${rel}>${text}</a>`)
  })

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,!?])/g, '$1<em>$2</em>')

  // Restore the stashed spans.
  s = s.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_m, i) => stash[Number(i)] ?? '')
  return s
}

export function parseMarkdown(md: string): ParsedPost {
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n')

  const segments: MarkdownSegment[] = []
  const headings: Heading[] = []
  const usedIds = new Set<string>()

  let buffer = '' // rendered HTML accumulating between embeds
  const push = (html: string) => {
    buffer += html
  }
  const flush = () => {
    if (buffer) {
      segments.push({ kind: 'html', html: buffer })
      buffer = ''
    }
  }

  const uniqueId = (text: string): string => {
    const base = slugify(text) || 'section'
    let id = base
    let n = 2
    while (usedIds.has(id)) id = `${base}-${n++}`
    usedIds.add(id)
    return id
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Blank line -- paragraph separator, nothing to emit.
    if (trimmed === '') {
      i++
      continue
    }

    // Embed block, on its own line.
    const embed = trimmed.match(EMBED_RE)
    if (embed) {
      flush()
      segments.push({ kind: 'embed', embed: { type: embed[1] as 'tutor' | 'job', slug: embed[2] } })
      i++
      continue
    }

    // Fenced code.
    if (/^```/.test(trimmed)) {
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i])
        i++
      }
      i++ // closing fence
      push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
      continue
    }

    // Heading.
    const h = trimmed.match(HEADING_RE)
    if (h) {
      const hashes = h[1].length
      const level: 2 | 3 = hashes <= 2 ? 2 : 3
      const text = h[2].trim()
      const id = uniqueId(text)
      headings.push({ id, text, level })
      push(`<h${level} id="${id}">${inline(esc(text))}</h${level}>`)
      i++
      continue
    }

    // Table -- a header row above a `--- | ---` delimiter, then body rows.
    if (isTableStart(lines, i)) {
      const head = tableCells(lines[i])
      i += 2 // header + delimiter
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(tableCells(lines[i]))
        i++
      }
      const th = head.map((c) => `<th>${inline(esc(c))}</th>`).join('')
      const trs = rows
        .map(
          (r) =>
            `<tr>${head
              .map((_, ci) => `<td>${inline(esc(r[ci] ?? ''))}</td>`)
              .join('')}</tr>`,
        )
        .join('')
      push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`)
      continue
    }

    // Horizontal rule.
    if (HR_RE.test(trimmed)) {
      push('<hr />')
      i++
      continue
    }

    // Blockquote -- consecutive `>` lines.
    if (BLOCKQUOTE_RE.test(line)) {
      const quote: string[] = []
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        quote.push(lines[i].match(BLOCKQUOTE_RE)![1])
        i++
      }
      push(`<blockquote><p>${inline(esc(quote.join(' ').trim()))}</p></blockquote>`)
      continue
    }

    // Unordered list.
    if (UL_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].match(UL_RE)![1]))}</li>`)
        i++
      }
      push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Ordered list.
    if (OL_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].match(OL_RE)![1]))}</li>`)
        i++
      }
      push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // Paragraph -- gather consecutive plain lines until a blank or a block start.
    const para: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      const t = l.trim()
      if (
        t === '' ||
        EMBED_RE.test(t) ||
        /^```/.test(t) ||
        HEADING_RE.test(t) ||
        HR_RE.test(t) ||
        UL_RE.test(l) ||
        OL_RE.test(l) ||
        BLOCKQUOTE_RE.test(l) ||
        isTableStart(lines, i)
      ) {
        break
      }
      para.push(l)
      i++
    }
    push(`<p>${inline(esc(para.join(' ')))}</p>`)
  }

  flush()

  return { segments, headings, readingTime: readingTimeMinutes(md) }
}

/** Words / 200 wpm, floored at one minute. Embeds and markup are stripped. */
export function readingTimeMinutes(md: string): number {
  const words = plainText(md).split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

/**
 * The prose, with markup and embed lines removed. For meta-description
 * fallbacks and the RSS summary -- never rendered as HTML.
 */
export function plainText(md: string): string {
  return (md ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !EMBED_RE.test(l.trim()))
    .join(' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
