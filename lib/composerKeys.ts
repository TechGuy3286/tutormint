'use client'

import type { KeyboardEvent } from 'react'

// Enter sends. Shift+Enter is a newline.
//
// ONE HELPER so every composer on the platform behaves the same way. There are
// three (the inbox composer, the chat page, and the reply box on an
// application) and until now none of them did this at all: Enter inserted a
// newline and the only way to send was to find and press the button, which on
// a phone means dismissing the keyboard first. Every messaging product a
// Pakistani parent already uses sends on Enter, so the surprise costs more
// than the convention.
//
// TWO EXCEPTIONS, and both matter more than they look.
//
//   isComposing — while an IME is open (Urdu keyboards, and every phone
//   predictive bar) Enter COMMITS the candidate word. Sending there would
//   truncate the sentence mid-word, and the member would have no idea why.
//   `nativeEvent.isComposing` is the only reliable signal; keyCode 229 is the
//   older one and is still emitted by some Android keyboards, so both are read.
//
//   Shift+Enter — a newline, because a tutor writing three lines about their
//   availability must be able to.
//
// Alt, Ctrl and Meta also fall through: Ctrl+Enter is "send" in some clients
// and a newline in others, and the one thing worse than an unfamiliar shortcut
// is one that does the opposite of what it does elsewhere. Only a bare Enter
// sends.

export function isSendKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
  const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number }
  if (native?.isComposing || native?.keyCode === 229) return false
  return true
}

/** The line every composer's textarea carries, so the shortcut is discoverable. */
export const COMPOSER_HINT = 'Enter to send · Shift+Enter for a new line'
