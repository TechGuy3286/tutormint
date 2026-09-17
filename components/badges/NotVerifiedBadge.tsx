// components/badges/NotVerifiedBadge.tsx
//
// The "Not verified" status badge (PR17 §2.1) — red (#C20202 / tm-red) on a light
// red tint (#FBEAEA / tm-tint-red), the true state of a visible tutor who has not
// paid the one-time verification fee. It sits on the same line as the stars and
// the Verified/Premium/Featured badges on cards and profiles.
//
// On the tutor's own dashboard first card (§1.2) it also shows the Urdu line
// "تصدیق نہیں ہوئی" underneath, for a tutor who reads Urdu more comfortably.

export default function NotVerifiedBadge({ urdu = false }: { urdu?: boolean }) {
  return (
    <span className="inline-flex flex-col items-start leading-tight">
      <span className="inline-flex items-center rounded-full bg-tm-tint-red px-2 py-0.5 text-[11px] font-bold text-tm-red">
        Not verified
      </span>
      {urdu && (
        <span lang="ur" dir="rtl" className="pt-0.5 text-[10px] font-semibold text-tm-red">
          تصدیق نہیں ہوئی
        </span>
      )}
    </span>
  )
}
