import { Fragment } from 'react'

import BlogEmbedTutor from '@/components/blog/BlogEmbedTutor'
import BlogEmbedJob from '@/components/blog/BlogEmbedJob'
import type { MarkdownSegment } from '@/lib/markdown'

// The rendered body of a post.
//
// The parser hands back an ordered list of segments: runs of already-safe HTML
// (every character escaped, only whitelisted tags) and embed markers. HTML runs
// go in via dangerouslySetInnerHTML — safe by construction, see lib/markdown.ts
// — and each embed marker becomes a live server-rendered card. Splitting the
// body this way is what lets a tutor or tuition card sit mid-article without
// the markdown renderer needing to know React.
//
// PROSE STYLING is arbitrary descendant selectors on the wrapper (brand tokens
// only, so the contrast gate is satisfied) rather than a typography plugin the
// project does not carry.

const PROSE =
  'max-w-none text-sm leading-relaxed text-slate-700 ' +
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:scroll-mt-24 [&_h2]:text-lg [&_h2]:font-black [&_h2]:text-tm-navy ' +
  '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:scroll-mt-24 [&_h3]:text-base [&_h3]:font-black [&_h3]:text-tm-navy ' +
  '[&_p]:my-3 ' +
  '[&_a]:font-semibold [&_a]:text-tm-red [&_a]:underline ' +
  '[&_strong]:font-bold [&_strong]:text-tm-navy ' +
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 ' +
  '[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-tm-navy/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600 ' +
  '[&_code]:rounded [&_code]:bg-tm-tint-navy [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] ' +
  '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-tm-black [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-slate-100 ' +
  '[&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_pre_code]:py-0 ' +
  '[&_hr]:my-6 [&_hr]:border-gray-200 ' +
  '[&_img]:my-4 [&_img]:rounded-xl ' +
  // Wide tables scroll inside their own box rather than the page (the
  // no-horizontal-scroll rule): display:block + overflow-x-auto on the table.
  '[&_table]:my-4 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-xs ' +
  '[&_th]:border [&_th]:border-gray-200 [&_th]:bg-tm-tint-navy [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-bold [&_th]:text-tm-navy ' +
  '[&_td]:border [&_td]:border-gray-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top'

export default function PostBody({ segments }: { segments: MarkdownSegment[] }) {
  return (
    <div className={PROSE}>
      {segments.map((seg, i) =>
        seg.kind === 'html' ? (
          <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ) : (
          <Fragment key={i}>
            {seg.embed.type === 'tutor' ? (
              <BlogEmbedTutor slug={seg.embed.slug} />
            ) : (
              <BlogEmbedJob slug={seg.embed.slug} />
            )}
          </Fragment>
        ),
      )}
    </div>
  )
}
