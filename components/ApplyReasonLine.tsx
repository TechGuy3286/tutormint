'use client'

import Link from 'next/link'

import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import type { ApplyBlock } from '@/lib/applyBlock'
import { formatDate } from '@/lib/datetime'

// The one small line under an inactive Apply button (owner, 5 Oct 2026): the
// actual reason, in English with a short Urdu line. Rendered by the Browse card,
// the tuition page and the dashboard lists from the same ApplyBlock, so the
// wording lives here once. No price anywhere — the quota line's Upgrade opens
// the existing upgrade sheet, which is where plans are described.

export default function ApplyReasonLine({ block, align = 'left' }: { block: ApplyBlock | null; align?: 'left' | 'right' }) {
  if (!block) return null
  const cls = `text-[11px] leading-snug text-slate-700 ${align === 'right' ? 'text-right' : ''}`
  const ur = 'block text-[11px] font-semibold text-gray-500'

  switch (block.kind) {
    case 'applied':
      return (
        <p className={cls}>
          {block.appliedAt ? `You applied on ${formatDate(block.appliedAt)}` : 'You have already applied'}
          <span lang="ur" dir="rtl" className={ur}>آپ پہلے ہی اپلائی کر چکے ہیں</span>
        </p>
      )
    case 'quota':
      return (
        <p className={cls}>
          {block.unlimited
            ? 'You’ve used this month’s applications.'
            : `You’ve used all ${block.quota} for this month.`}{' '}
          <UpgradeTrigger reason="tutor_apply_quota" className="font-bold text-tm-red hover:underline">
            Upgrade
          </UpgradeTrigger>
          <span lang="ur" dir="rtl" className={ur}>اس مہینے کی تمام درخواستیں استعمال ہو چکی ہیں</span>
        </p>
      )
    case 'doc':
      return (
        <p className={cls}>
          <Link href={block.href} className="font-bold text-tm-red hover:underline">
            Re-upload your document
          </Link>{' '}
          to apply again
          <span lang="ur" dir="rtl" className={ur}>دوبارہ اپلائی کرنے کے لیے اپنی دستاویز دوبارہ اپلوڈ کریں</span>
        </p>
      )
    case 'closed':
      return (
        <p className={cls}>
          This tuition is closed
          <span lang="ur" dir="rtl" className={ur}>یہ ٹیوشن بند ہو چکی ہے</span>
        </p>
      )
  }
}
