import { NextResponse } from 'next/server'

// Any /api/ path that matches no route (owner, 11 Oct 2026).
//
// Without this an unknown /api/ URL fell through to the site's not-found PAGE,
// which a script reading JSON cannot use. A catch-all is the least specific
// match, so every real route still wins; only an address with no handler lands
// here, and it gets a plain 404 in JSON for every method. Page routes are
// unchanged.

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE, notFound as HEAD, notFound as OPTIONS }
