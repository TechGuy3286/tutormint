// lib/viewAsPaths.ts — PURE, no imports. The "View as" exit address, in a file
// of its own so the browser banner (components/ViewAsBanner) can read it
// without pulling lib/viewAsCore's node:crypto into every page's shared
// script — that import alone added ~130 KB (compressed) to every public page
// (owner, 2 Nov 2026, phone speed).
export const VIEW_AS_EXIT_PATH = '/api/admin/view-as/exit'
