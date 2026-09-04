'use client'

import AppErrorView from '@/components/AppErrorView'

// The error boundary for everything outside app/(site) — /admin, and the root
// layout itself. Rendered without the site header and footer, because at this
// level neither has been rendered: this boundary replaces the whole tree below
// the document. The links in the body are the way back.
export default AppErrorView
