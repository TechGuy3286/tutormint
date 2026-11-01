// The 5-minute cron moved to /api/cron/every-5-min (owner, 31 Oct 2026), a
// neutral name: it publishes scheduled posts, sends Google indexing notices,
// runs search alerts, the bank email reader and the View-as clean-up, and still
// re-checks PayPro until the cut-off. This old path stays working only until
// the new one is confirmed running on Vercel, then it is removed.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export { GET } from '../every-5-min/route'
