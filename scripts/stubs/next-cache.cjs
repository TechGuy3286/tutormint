// A stand-in for `next/cache` in read-only scripts (owner, 28 Oct 2026):
// nothing is cached, nothing is revalidated — every call reads fresh.
exports.unstable_cache = (fn) => fn
exports.revalidateTag = () => {}
exports.revalidatePath = () => {}
exports.updateTag = () => {}
exports.unstable_noStore = () => {}
exports.cacheTag = () => {}
exports.cacheLife = () => {}
