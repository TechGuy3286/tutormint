-- 219_admin_list_page.sql — owner, 1 Nov 2026 (push 2 of "Fast admin").
--
-- One read for an admin list page over admin_list_rows (migration 218): the
-- search, the chip rows (each counted over what the search and the rows above
-- it leave — the rule lib/cardGridPagingCore has always used), one final split
-- (the Documents chips on People, To do / Followed up on Follow-ups), the
-- total, and the 25 rows asked for. Counts are worked out in SQL; only the
-- rows on screen leave the database.
--
--   p_list    the list ('people:tutor', 'fu_tutor:recent', …)
--   p_fixed   jsonb containment every row must match first (e.g. not a hidden
--             account) — counted as "all"
--   p_since / p_until   optional range on tags->>'joined_at' (sign-up day chips)
--   p_needle  the search, lower case; matched anywhere in `search`
--   p_digits  4+ typed digits, matched anywhere in `digits` (mobile)
--   p_rows    ordered [{"param":"paid","value":"all"}, …]; a tag may be a
--             string or an array (Follow-ups chips) — 'all' does not narrow
--   p_split / p_split_values   the final split's tag and the value(s) shown
--   p_order   'pos' | 'sort_asc' (sort_at ascending, unknown last, then pos) |
--             'overdue_rank' (overdue first, then tags->>'rank', then pos) |
--             'overdue' (overdue first, then pos) |
--             'overdue_sort' (overdue first, then sort_at, then pos)
--
-- Service role only. Re-runnable.

create or replace function public.admin_list_page(
  p_list text,
  p_fixed jsonb default '{}'::jsonb,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_needle text default '',
  p_digits text default '',
  p_rows jsonb default '[]'::jsonb,
  p_split text default null,
  p_split_values text[] default null,
  p_order text default 'pos',
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_all integer;
  v_searched integer;
  v_row jsonb;
  v_param text;
  v_value text;
  v_counts jsonb := '{}'::jsonb;
  v_c jsonb;
  v_conds text := '';
  v_split jsonb := null;
  v_total integer;
  v_page jsonb;
  v_base text;
  v_where text;
begin
  -- The fixed scope: the list, the hidden-account rule, the sign-up window.
  v_base := format('l.list = %L and l.tags @> %L::jsonb', p_list, coalesce(p_fixed, '{}'::jsonb));
  if p_since is not null then
    v_base := v_base || format(' and (l.tags->>''joined_at'')::timestamptz >= %L', p_since);
  end if;
  if p_until is not null then
    v_base := v_base || format(' and (l.tags->>''joined_at'')::timestamptz < %L', p_until);
  end if;
  execute format('select count(*) from admin_list_rows l where %s', v_base) into v_all;

  -- The search.
  v_where := v_base;
  if coalesce(p_needle, '') <> '' then
    if length(coalesce(p_digits, '')) >= 4 then
      v_where := v_where || format(' and (position(%L in l.search) > 0 or position(%L in l.digits) > 0)', p_needle, p_digits);
    else
      v_where := v_where || format(' and position(%L in l.search) > 0', p_needle);
    end if;
  end if;
  execute format('select count(*) from admin_list_rows l where %s', v_where) into v_searched;

  -- Each chip row, counted over what is left, then narrowed by its choice.
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_param := v_row->>'param';
    v_value := coalesce(v_row->>'value', 'all');
    execute format(
      $q$select coalesce(jsonb_object_agg(v, n), '{}'::jsonb) from (
           select v, count(*)::int n from (
             select case jsonb_typeof(l.tags->%1$L)
                      when 'array' then e.v
                      else l.tags->>%1$L end as v
             from admin_list_rows l
             left join lateral jsonb_array_elements_text(case jsonb_typeof(l.tags->%1$L) when 'array' then l.tags->%1$L else '[]'::jsonb end) as e(v) on true
             where %2$s
           ) x where v is not null group by v) y$q$,
      v_param, v_where
    ) into v_c;
    execute format('select count(*) from admin_list_rows l where %s', v_where) into v_total;
    v_counts := v_counts || jsonb_build_object(v_param, v_c || jsonb_build_object('all', v_total));
    if v_value <> 'all' then
      v_where := v_where || format(
        ' and (l.tags->>%1$L = %2$L or (jsonb_typeof(l.tags->%1$L) = ''array'' and l.tags->%1$L ? %2$L))',
        v_param, v_value
      );
    end if;
  end loop;

  -- The final split (Documents / To do · Followed up), counted, then narrowed.
  if p_split is not null then
    execute format(
      'select coalesce(jsonb_object_agg(v, n), ''{}''::jsonb) from (select l.tags->>%L v, count(*)::int n from admin_list_rows l where %s group by 1) x where v is not null',
      p_split, v_where
    ) into v_split;
    if p_split_values is not null then
      v_where := v_where || format(' and l.tags->>%L = any(%L::text[])', p_split, p_split_values);
    end if;
  end if;

  execute format('select count(*) from admin_list_rows l where %s', v_where) into v_total;

  execute format(
    $q$select coalesce(jsonb_agg(jsonb_build_object('id', member_id, 'row', row) order by o1, o2, o3, pos), '[]'::jsonb) from (
         select l.member_id, l.row, l.pos,
           case when %1$L in ('overdue_rank', 'overdue', 'overdue_sort') then (case when l.tags->>'overdue' = 'true' then 0 else 1 end) else 0 end as o1,
           case when %1$L in ('sort_asc', 'overdue_sort') then l.sort_at end as o2,
           case when %1$L = 'overdue_rank' then coalesce((l.tags->>'rank')::int, 0) else 0 end as o3
         from admin_list_rows l where %2$s
         order by o1, o2 asc nulls last, o3, l.pos
         offset %3$s limit %4$s) p$q$,
    coalesce(p_order, 'pos'), v_where, greatest(0, coalesce(p_offset, 0)), least(500, greatest(1, coalesce(p_limit, 25)))
  ) into v_page;

  return jsonb_build_object(
    'all', v_all,
    'searched', v_searched,
    'rowCounts', v_counts,
    'split', coalesce(v_split, '{}'::jsonb),
    'total', v_total,
    'rows', v_page
  );
end;
$$;

revoke all on function public.admin_list_page(text, jsonb, timestamptz, timestamptz, text, text, jsonb, text, text[], text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_page(text, jsonb, timestamptz, timestamptz, text, text, jsonb, text, text[], text, integer, integer) to service_role;
