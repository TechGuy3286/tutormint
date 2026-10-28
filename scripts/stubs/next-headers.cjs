// A stand-in for `next/headers` in read-only scripts (owner, 28 Oct 2026).
exports.cookies = async () => ({ getAll: () => [], get: () => undefined, set: () => {}, delete: () => {}, has: () => false })
exports.headers = async () => new Headers()
exports.draftMode = async () => ({ isEnabled: false })
