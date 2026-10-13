/**
 * scripts/report-seeded-areas.ts — read-only: which of the areas listed for
 * migration 166 were added by it and which were already in Locations.
 *   npx tsx --env-file=.env.local scripts/report-seeded-areas.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  // The 48 rows the migration added carry the highest ids.
  const { rows } = await c.query(
    `with newest as (select id from location_areas order by id desc limit 48)
     select c.name as city, a.name as area, (a.id in (select id from newest)) as added
       from location_areas a join location_cities c on c.id = a.city_id
      where lower(a.name) in ('harbanspura','thokar niaz baig','valencia town','badian road','izmir town','manawan','ichra','mazang','dharampura','sabzazar','taj bagh','sant nagar','shalamar town','salamatpura','askari 9','askari 11','parsi colony','liaqatabad','gulzar-e-hijri','civil lines','garden west','garden east','gulshan-e-hadeed','gulistan-e-maymar','pib colony','pak colony','qayyumabad','tipu sultan','azam town','gizri','gulshan-e-roomi','kaechs','kazimabad','kharadar','mehmoodabad','model colony','sharfabad','tariq road','saadi town','soldier bazar','metroville','malir','new karachi','korangi','bahria town karachi','chaklala','fauji colony','airport housing society','e-11','bani gala','ghauri town','zaraj housing society')
        and c.name in ('Lahore','Karachi','Rawalpindi','Islamabad')
      order by added, c.name, a.name`,
  )
  const existed = rows.filter((r: { added: boolean }) => !r.added)
  console.log(`added: ${rows.length - existed.length} · already in Locations: ${existed.length}`)
  for (const r of existed) console.log(`  already there: ${r.area} (${r.city})`)
  await c.end()
}

void main()
