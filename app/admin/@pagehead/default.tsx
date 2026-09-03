// Required by Next for a named slot: what to render when the slot has no
// match for the current URL. The optional catch-all beside this file matches
// every admin path including /admin itself, so this is the belt to that
// braces -- a blank strip rather than a crash if a future route escapes it.
export default function AdminPageHeadDefault() {
  return null
}
