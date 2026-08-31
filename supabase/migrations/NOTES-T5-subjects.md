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

## One correction to how you detect a level-leaf

CLAUDE.md says these are `leaf_type='level'` rows. **They are not**, in the
data as seeded. Verified against the live table:

```
Translation of Quran -> category: Holy Quran       (leaf_type=subject, subject_slug NULL)
Basketball Skills    -> category: Sports & Games   (leaf_type=subject, subject_slug NULL)
Carrom               -> category: Sports & Games   (leaf_type=subject, subject_slug NULL)
Ludo                 -> category: Sports & Games   (leaf_type=subject, subject_slug NULL)
IELTS Preparation    -> category: Test Preparations (leaf_type=subject, subject_slug NULL)
```

All 896 rows in `taxonomy_master` carry `leaf_type='subject'`; the seed never
emits `'level'`. What actually distinguishes a level-leaf is
**`subject_slug IS NULL`** — 120 of the 896 rows.

**T5 and `TaxonomySelector` must branch on `subject_slug IS NULL`, not on
`leaf_type`.** Filtering on `leaf_type='level'` returns zero rows.

Either the seed generator should be fixed to emit `leaf_type='level'` for
those 120 rows, or CLAUDE.md's taxonomy section should be corrected to describe
the `subject_slug IS NULL` rule. Owner's call — flagged, not changed here.
