/**
 * scripts/test-indexing.ts — npm run test:indexing
 *
 * The private-key normaliser used before signing an Indexing API request
 * (owner, 5 Oct 2026): a key pasted with literal "\n" sequences and one pasted
 * with real line breaks must both come out as the same PEM. Pure; no network,
 * no secrets — the fixture is a made-up PEM-shaped string.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalisePrivateKey, normaliseClientEmail, looksLikePem, classifyTokenError, describeKeyShape } from '../lib/googleIndexingCore'

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\nabcDEF123/+=\n-----END PRIVATE KEY-----'

test('normalisePrivateKey: literal "\\n" sequences become real line breaks', () => {
  const literal = PEM.replace(/\n/g, '\\n')
  assert.ok(!literal.includes('\n'), 'the fixture has no real newline')
  assert.equal(normalisePrivateKey(literal), PEM)
  assert.ok(looksLikePem(normalisePrivateKey(literal)))
})

test('normalisePrivateKey: a key that already has real line breaks is unchanged', () => {
  assert.equal(normalisePrivateKey(PEM), PEM)
  assert.equal(normalisePrivateKey(`\n  ${PEM}\n`), PEM, 'outer whitespace stripped')
  assert.equal(normalisePrivateKey(PEM.replace(/\n/g, '\r\n')), PEM, 'Windows line endings')
})

test('normalisePrivateKey: wrapping quotes (as pasted from JSON) are stripped', () => {
  assert.equal(normalisePrivateKey(`"${PEM.replace(/\n/g, '\\n')}"`), PEM)
  assert.equal(normalisePrivateKey(`'${PEM}'`), PEM)
  assert.equal(normalisePrivateKey(''), '')
  assert.equal(normalisePrivateKey(null), '')
  assert.equal(looksLikePem('not a key'), false)
})

test('normalisePrivateKey / normaliseClientEmail: a pasted JSON-line fragment yields only the key / the address', () => {
  // The shape seen live on 5 Oct 2026: the value is the JSON line, not the value.
  const fragment = `private_key": "${PEM.replace(/\n/g, '\\n')}",`
  assert.equal(normalisePrivateKey(fragment), PEM)
  assert.equal(normalisePrivateKey(`"private_key": "${PEM}"`), PEM)
  assert.equal(normaliseClientEmail('client_email": "tutormint-indexing@example-project.iam.gserviceaccount.com'), 'tutormint-indexing@example-project.iam.gserviceaccount.com')
  assert.equal(normaliseClientEmail('  "svc@example.com",'), 'svc@example.com')
  assert.equal(normaliseClientEmail('svc@example.com'), 'svc@example.com')
})

test('describeKeyShape: shape facts only, never key material', () => {
  const shape = describeKeyShape(`private_key": "${PEM.replace(/\n/g, '\\n')}",`)
  assert.equal(shape.jsonFragment, true)
  assert.equal(shape.literalNewlines, true)
  assert.equal(shape.pemBlockFound, true)
  assert.equal(shape.hasBegin && shape.hasEnd, true)
  assert.equal(shape.lines, 4)
  assert.equal(shape.firstLine, '-----BEGIN PRIVATE KEY-----')
  assert.equal(shape.lastLine, '-----END PRIVATE KEY-----')
  const json = JSON.stringify(shape)
  assert.ok(!json.includes('MIIEvQ') && !json.includes('abcDEF'), 'no key bytes in the shape')
  const bad = describeKeyShape('-----BEGIN PRIVATE KEY-----\nMIIEvQ')
  assert.equal(bad.hasEnd, false)
  assert.equal(bad.pemBlockFound, false)
  assert.equal(bad.lastLine, '(not a PEM marker)')
})

test('classifyTokenError: short plain words, never the key or token', () => {
  assert.equal(classifyTokenError('invalid_grant: Invalid JWT Signature.'), 'wrong email')
  assert.equal(classifyTokenError('error:1E08010C:DECODER routines::unsupported'), 'invalid key')
  assert.equal(classifyTokenError('secretOrPrivateKey must be an asymmetric key'), 'invalid key')
  assert.equal(classifyTokenError('Permission denied on resource'), 'permission denied')
  assert.equal(classifyTokenError('Something else entirely'), 'Something else entirely')
})
