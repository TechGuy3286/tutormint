// The message shown when checkout is not open to this account yet — a 403
// `checkout_closed` from /api/payments/checkout (PR104 §5). This is a known,
// benign state, NOT a failure, so it gets its own plain line
// rather than the generic "Something went wrong" box used for real errors.

export default function CheckoutClosedNotice() {
  return (
    <div className="rounded-xl border border-tm-navy/20 bg-tm-tint-navy p-3 text-xs leading-relaxed text-tm-navy">
      <p className="font-bold">Online payment is not open yet. Please check back soon.</p>
    </div>
  )
}
