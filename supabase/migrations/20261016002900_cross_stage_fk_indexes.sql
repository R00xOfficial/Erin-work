-- Adds a covering index for every foreign key in public that lacks one (advisor lint 0001), so joins and cascading deletes stay fast as data grows.
do $$
declare r record; n integer := 0;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname, c.conkey,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint c
    join pg_namespace ns on ns.oid = c.connamespace and ns.nspname = 'public'
    where c.contype = 'f'
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey)
  loop
    execute format('create index if not exists %I on %s (%s)', left('fk_' || r.conname, 63), r.tbl, r.cols);
    n := n + 1;
  end loop;
  raise notice 'created % indexes', n;
end $$;
