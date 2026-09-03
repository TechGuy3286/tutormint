import assert from 'node:assert/strict'
import { test } from 'node:test'

import { groupFeed, threadKeyOf, type FeedItem } from '../lib/feedGrouping'

// The grouping invariant, asserted rather than described.
//
// "Nothing may be silently dropped" is the whole contract of this function: a
// notification that vanishes into a group nobody counted is worse than no
// grouping at all, because the reader has no way to know it existed. groupFeed
// throws if the arithmetic ever stops adding up; these tests are what prove
// the three modes each keep it, including across the day boundary the messages
// mode deliberately ignores.
//
// Pure by construction -- lib/feedGrouping.ts imports nothing but pkDayKey and
// familyFor -- so this runs under `tsx --test` with no server, no database and
// no request. Same reasoning as scripts/test-jobcopy.ts.

const KARACHI_OFFSET = '+05:00'

function at(day: string, hhmm: string): string {
  return `${day}T${hhmm}:00${KARACHI_OFFSET}`
}

function item(over: Partial<FeedItem> & { id: string; type: string; at: string }): FeedItem {
  return {
    source: 'notification',
    text: over.type,
    href: null,
    unread: false,
    ...over,
  }
}

/** Every input row appears in exactly one group, and counts match. */
function assertLossless(input: FeedItem[], groups: ReturnType<typeof groupFeed>) {
  const seen = new Set<string>()
  let total = 0
  for (const g of groups) {
    assert.equal(g.count, g.items.length, `count and items disagree on ${g.key}`)
    for (const i of g.items) {
      assert.ok(!seen.has(i.id), `row ${i.id} appears in two groups`)
      seen.add(i.id)
      total += 1
    }
  }
  assert.equal(total, input.length, 'a row was dropped')
  for (const i of input) assert.ok(seen.has(i.id), `row ${i.id} is in no group`)
}

// Two days, two conversations, six messages, and three other events between
// them -- the shape the dashboard band actually sees.
const FEED: FeedItem[] = [
  item({ id: 'm1', type: 'message_received', at: at('2026-09-04', '09:00'), href: '/messages/aaa', unread: true }),
  item({ id: 'm2', type: 'message_received', at: at('2026-09-04', '08:30'), href: '/messages/bbb' }),
  item({ id: 'h1', type: 'was_hired', at: at('2026-09-04', '08:00') }),
  item({ id: 'm3', type: 'message_received', at: at('2026-09-03', '22:00'), href: '/messages/aaa' }),
  item({ id: 'j1', type: 'job_posted', at: at('2026-09-03', '21:00') }),
  item({ id: 'j2', type: 'job_posted', at: at('2026-09-03', '20:00') }),
  item({ id: 'm4', type: 'message_sent', at: at('2026-09-03', '19:00'), href: '/messages/bbb' }),
  item({ id: 'j3', type: 'job_posted', at: at('2026-09-02', '19:00') }),
  item({ id: 'm5', type: 'message_received', at: at('2026-09-02', '10:00'), href: '/messages/ccc' }),
  item({ id: 'm6', type: 'message_received', at: at('2026-09-02', '09:00'), href: '/messages/aaa' }),
]

test('default mode: consecutive, same type, same day', () => {
  const groups = groupFeed(FEED)
  assertLossless(FEED, groups)
  // j1 and j2 are the same day and adjacent, so they are one card; j3 is a
  // different day and stays its own.
  const jobs = groups.filter((g) => g.type === 'job_posted')
  assert.deepEqual(
    jobs.map((g) => g.count),
    [2, 1],
  )
  // Messages are NOT collapsed in this mode.
  assert.equal(groups.filter((g) => g.type.startsWith('message')).length, 4)
})

test("mode 'all': one card for every message, whatever the day", () => {
  const groups = groupFeed(FEED, { messages: 'all', inboxHref: '/tutor/dashboard/messages' })
  assertLossless(FEED, groups)

  const messageGroups = groups.filter((g) => g.collapsedAcrossDays)
  assert.equal(messageGroups.length, 1, 'messages must collapse to exactly one card')

  const card = messageGroups[0]
  assert.equal(card.count, 6, 'all six messages, across three days and two types')
  assert.equal(card.href, '/tutor/dashboard/messages', 'the card goes to the inbox, not a thread')
  assert.equal(card.unread, true, 'unread if any row in it is unread')
  // The newest message is the head, so "latest …" is the newest, not the first
  // one the loop happened to see.
  assert.equal(card.head.id, 'm1')

  // Non-message events keep per-day grouping and their own order.
  assert.deepEqual(
    groups.filter((g) => !g.collapsedAcrossDays).map((g) => `${g.type}:${g.count}`),
    ['was_hired:1', 'job_posted:2', 'job_posted:1'],
  )
})

test("mode 'all': a mixed run is worded by what was received", () => {
  // Newest first: a message the member SENT, then four they received. Keyed on
  // the newest alone the card would read "You sent 5 messages".
  const mixed: FeedItem[] = [
    item({ id: 's1', type: 'message_sent', at: at('2026-09-04', '10:00'), href: '/messages/aaa' }),
    item({ id: 'r1', type: 'message_received', at: at('2026-09-04', '09:00'), href: '/messages/aaa' }),
    item({ id: 'r2', type: 'message_received', at: at('2026-09-03', '09:00'), href: '/messages/bbb' }),
  ]
  const [card] = groupFeed(mixed, { messages: 'all', inboxHref: '/x' })
  assertLossless(mixed, [card])
  assert.equal(card.type, 'message_received')
  assert.equal(card.count, 3)
  assert.equal(card.head.id, 's1', 'the head is still the newest row')
})

test("mode 'all': the messages card sits where its newest member was", () => {
  const groups = groupFeed(FEED, { messages: 'all', inboxHref: '/x' })
  // m1 is the newest row in the whole feed, so the card is first -- the band
  // stays newest-first rather than pulling messages to the top or bottom.
  assert.equal(groups[0].collapsedAcrossDays, true)
})

test("mode 'byThread': one row per conversation", () => {
  const groups = groupFeed(FEED, { messages: 'byThread' })
  assertLossless(FEED, groups)

  const threads = groups.filter((g) => g.type.startsWith('message'))
  assert.equal(threads.length, 3, 'aaa, bbb and ccc')
  assert.deepEqual(
    threads.map((g) => `${threadKeyOf(g.href)}:${g.count}`),
    ['aaa:3', 'bbb:2', 'ccc:1'],
  )
  // Each row keeps its own conversation as its destination.
  assert.equal(threads[0].href, '/messages/aaa')
  assert.ok(!threads[0].collapsedAcrossDays, 'a per-thread row is not the band-wide card')
})

test('an empty feed groups to nothing, in every mode', () => {
  for (const mode of ['none', 'all', 'byThread'] as const) {
    assert.deepEqual(groupFeed([], { messages: mode }), [])
  }
})

test('a message with no thread in its href still lands in exactly one group', () => {
  // A notification whose href points at the list rather than a conversation.
  const odd: FeedItem[] = [
    item({ id: 'x1', type: 'message_received', at: at('2026-09-04', '09:00'), href: '/account/notifications' }),
    item({ id: 'x2', type: 'message_received', at: at('2026-09-04', '08:00'), href: null }),
  ]
  const groups = groupFeed(odd, { messages: 'byThread' })
  assertLossless(odd, groups)
  // No thread to key on, so they do not silently merge into one conversation.
  assert.equal(groups.length, 2)
})

test('threadKeyOf reads the conversation out of both href shapes', () => {
  assert.equal(threadKeyOf('/messages/abc-123'), 'abc-123')
  assert.equal(threadKeyOf('/parent/dashboard/messages/abc-123'), 'abc-123')
  assert.equal(threadKeyOf('/parent/dashboard/messages/abc-123?from=bell'), 'abc-123')
  assert.equal(threadKeyOf('/browse/tutors'), null)
  assert.equal(threadKeyOf(null), null)
})
