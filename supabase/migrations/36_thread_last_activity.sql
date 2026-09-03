-- 36_thread_last_activity.sql — a total sort key for the conversation list.
--
-- `threads.last_message_at` is set when a message is sent and left NULL until
-- then, so four of the seven existing threads have no value. That was fine
-- while the list was a single unpaged query sorted in memory. It is not fine
-- for an infinite-scroll inbox: a keyset cursor needs a key that is present on
-- every row and unique across rows, and NULL is neither.
--
-- Ordering "NULLS LAST then created_at" would work for the FIRST page and then
-- quietly break, because a cursor cannot express "I am somewhere inside the
-- null group" -- there is no value to compare against. The fix is to give the
-- column the value it always implied: a conversation with no messages was last
-- active when it was created.
--
-- The id in the cursor does the other half. `last_message_at` alone is not
-- unique -- two threads touched in the same millisecond compare equal, and a
-- keyset that cannot say which side of a tie it is on will either repeat a row
-- or skip one. (id) makes the key total.

begin;

update public.threads
set last_message_at = created_at
where last_message_at is null;

alter table public.threads alter column last_message_at set default now();
alter table public.threads alter column last_message_at set not null;

-- The list reads (participant, last_message_at desc) and pages on it. Both
-- participant indexes already exist with that shape
-- (threads_participant_a_idx, threads_participant_b_idx), so the ordering the
-- inbox asks for is already served -- this migration only makes their sort
-- column non-null so a cursor can land on it.

commit;
