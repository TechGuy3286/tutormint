// scripts/test-social-verified-render-2.ts — shard 2 of the Social posts
// render matrix (see SOCIAL_RENDER_SHARD in scripts/test-social-verified.ts).
// Node runs test files in parallel, so the ~200 renders finish in a quarter
// of the time. require() (not import) so the shard is set before it loads.

process.env.SOCIAL_RENDER_SHARD = '2/4'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./test-social-verified')

export {}
