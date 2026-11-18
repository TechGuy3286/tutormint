/**
 * scripts/test-job-code-search.ts — PR-07 (owner, 18 Nov 2026): the
 * Applications search and the admin Tuitions search find a tuition by its
 * codes, "JOB-TX-GYEMZMG" or "TM-2558", case-insensitive, with or without the
 * prefix. INVENTED codes only.
 *
 *   npm run test:jobcodesearch
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { bareJobCode, jobCodeMatches, jobCodeOrTerms, parseJobCode } from '../lib/jobCodeSearchCore'
import { searchMatches } from '../lib/applicationStageCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const JOB = { ref: 'TM-2558', tx: 'JOB-TX-GYEMZMG' }

test('the job code matches with or without the prefix, in any case', () => {
  for (const q of ['JOB-TX-GYEMZMG', 'job-tx-gyemzmg', 'jobtxgyemzmg', 'job tx gyemzmg', 'GYEMZMG', 'gyemzmg', 'gyem']) {
    assert.ok(jobCodeMatches(JOB, q), q)
  }
  for (const q of ['TM-2558', 'tm-2558', 'tm2558', 'TM 2558', '2558']) assert.ok(jobCodeMatches(JOB, q), q)
  for (const q of ['JOB-TX-AAAAAAA', 'TM-9999', '9999', 'zzz', '']) assert.ok(!jobCodeMatches(JOB, q), q)
  assert.equal(bareJobCode('JOB-TX-GYEMZMG'), 'GYEMZMG')
  assert.equal(bareJobCode('TM-2558'), '2558')
})

test('a typed code is read into its stored shape; plain words are not codes', () => {
  assert.deepEqual(parseJobCode('tm2558'), { ref: 'TM-2558', tx: null })
  assert.deepEqual(parseJobCode('TM-2558'), { ref: 'TM-2558', tx: null })
  assert.deepEqual(parseJobCode('job tx gyemzmg'), { ref: null, tx: 'JOB-TX-GYEMZMG' })
  assert.deepEqual(parseJobCode('physics'), { ref: null, tx: null })
  assert.deepEqual(parseJobCode('2558'), { ref: null, tx: null }, 'bare digits are already matched by the plain search')
  assert.deepEqual(jobCodeOrTerms('tm2558'), ['ref_id.ilike.%TM-2558%'])
  assert.deepEqual(jobCodeOrTerms('jobtxgyemzmg'), ['job_tx_id.ilike.%JOB-TX-GYEMZMG%'])
  assert.deepEqual(jobCodeOrTerms('lahore'), [])
  // Only code characters reach the PostgREST filter.
  for (const t of [...jobCodeOrTerms('tm2558'), ...jobCodeOrTerms('job-tx-abc123')]) assert.match(t, /^[a-z_]+\.ilike\.%[A-Z0-9-]+%$/)
})

test('Applications search: by the job code and the TM number, and the old matches still work', () => {
  const row = { tutorName: 'Invented Tutor', jobRef: 'TM-2558', jobTx: 'JOB-TX-GYEMZMG', jobTitle: 'Physics tutor', jobCity: 'Karachi' }
  for (const q of ['JOB-TX-GYEMZMG', 'gyemzmg', 'TM-2558', 'tm2558', '2558', 'invented', 'physics', 'karachi']) assert.ok(searchMatches(row, q), q)
  assert.equal(searchMatches(row, 'lahore'), false)
  assert.equal(searchMatches({ ...row, jobTx: null }, 'gyemzmg'), false)
})

test('both searches are wired: Applications rows carry the code; Tuitions adds the code terms', () => {
  const tracking = read('lib/applicationTracking.ts')
  assert.match(tracking, /jobTx: j\?\.job_tx_id \?\? null/)
  const jobs = read('lib/adminJobs.ts')
  assert.match(jobs, /job_tx_id\.ilike\.%\$\{term\}%/)
  assert.match(jobs, /\.\.\.jobCodeOrTerms\(filters\.q\)/)
})
