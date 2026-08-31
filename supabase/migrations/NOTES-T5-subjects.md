# Note for T5 — the 6 unmatched job subjects

`05_data_migration.sql` matched job/tutor subject text against
`taxonomy_subjects.name` exactly. 33 of 39 distinct tokens matched. The 6 that
did not are listed in `unmatched-subjects.txt` and were **left unmatched on
purpose** — no taxonomy row was invented and no fuzzy matching was applied.

They are not junk. Five of them exist in the taxonomy as **level-leaves**: the
level itself is the selectable item and there is no subject beneath it.

| unmatched value | category | exists as |
|---|---|---|
| `IELTS Preparation` | Test Preparations | `taxonomy_levels` row |
| `Translation of Quran` | Holy Quran | `taxonomy_levels` row |
| `Carrom` | Sports & Games | `taxonomy_levels` row |
| `Ludo` | Sports & Games | `taxonomy_levels` row |
| `Basketball Skills` | Sports & Games | `taxonomy_levels` row |
| `General` | — | genuinely absent; free-text junk |

So job editing in T5 must let a parent pick a **level-type leaf**, not only a
subject. Once a parent next edits one of these jobs, the value maps naturally.

## Detecting a level-leaf

`leaf_type = 'level'` is now the reliable marker. `subject_slug IS NULL` is
equivalent — the two agree on exactly the same 120 rows — so either works:

```sql
select count(*) from taxonomy_master where leaf_type = 'level';        -- 120
select count(*) from taxonomy_master where subject_slug is null;       -- 120
```

Current distribution of `taxonomy_master` (896 rows):

| leaf_type | rows | subject_slug null |
|---|---:|---:|
| `level`   | 120 | 120 |
| `subject` | 776 | 0 |

### History

As originally seeded this was **not** true: the generator emitted
`leaf_type='subject'` for all 896 rows, so filtering on `leaf_type='level'`
returned nothing, and only `subject_slug IS NULL` worked. Fixed in
`12_taxonomy_leaf_type.sql` (120 rows updated), and in
`supabase/seed/seed_taxonomy.sql` itself so a re-seed produces the right value
directly. `03_taxonomy.sql` was regenerated from the corrected seed, so all
three are consistent and CLAUDE.md's description is now accurate.
