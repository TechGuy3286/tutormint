// Node module hook for read-only scripts (owner, 28 Oct 2026): `next/headers`
// resolves to scripts/stubs/next-headers.cjs (no cookies, no headers) and
// `next/cache` to a no-cache stand-in, so the
// server loaders run as a signed-out guest. Synchronous hooks cover require()
// as well as import.   npx tsx --import ./scripts/stubs/guest-register.mjs …
import { registerHooks } from 'node:module'
const stub = new URL('./next-headers.cjs', import.meta.url).href
const cacheStub = new URL('./next-cache.cjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/headers' || specifier === 'next/headers.js') return { url: stub, shortCircuit: true, format: 'commonjs' }
    if (specifier === 'next/cache' || specifier === 'next/cache.js') return { url: cacheStub, shortCircuit: true, format: 'commonjs' }
    return next(specifier, context)
  },
})
