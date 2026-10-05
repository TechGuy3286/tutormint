// lib/googleIndexingCore.ts
//
// The PURE half of the Google Indexing client (owner, 5 Oct 2026): what can be
// unit-tested without `server-only`, next/server or googleapis.
//
// THE KEY FORMAT. A service-account private key pasted into Vercel usually
// arrives with the JSON file's literal two-character "\n" sequences (and often
// wrapped in quotes); pasted from a PEM file it already has real line breaks.
// Both must sign. `normalisePrivateKey` turns literal "\n" into real newlines,
// strips wrapping quotes and surrounding whitespace, and leaves a key that
// already has real line breaks unchanged. It never logs or returns the key
// anywhere else — callers hand it straight to the signer.

/** Literal "\n" → newline; wrapping quotes and outer whitespace stripped;
 *  a key that already has real line breaks is left as it is. */
export function normalisePrivateKey(raw: string | null | undefined): string {
  let key = (raw ?? '').trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }
  // Windows line endings → \n, then literal backslash-n → newline.
  key = key.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim()
  return key
}

/** Does this look like a PEM private key — the only shape the signer accepts? */
export function looksLikePem(key: string): boolean {
  return /^-----BEGIN (RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (RSA )?PRIVATE KEY-----$/.test(key.trim())
}

/**
 * A short, plain word for a token failure, from Google's / the signer's error
 * text — never the key, never the token. Anything unrecognised is returned as a
 * trimmed message with no secrets in it (Google's messages carry none).
 */
export function classifyTokenError(message: string): string {
  const m = message.toLowerCase()
  if (/invalid_grant|account not found|invalid jwt signature|invalid_client/.test(m)) return 'wrong email'
  if (/pem|private key|decoder|asn1|1e08010c|unsupported|secretorprivatekey|no key/.test(m)) return 'invalid key'
  if (/access_denied|unauthorized_client|permission/.test(m)) return 'permission denied'
  return message.slice(0, 160)
}
