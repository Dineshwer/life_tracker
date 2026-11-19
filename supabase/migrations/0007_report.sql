-- 0005: read-only post-migration report. The SQL editor shows the result of the LAST statement, so apply-all.sql ends with this.
-- Look for: every constraint 'validated' (otherwise legacy rows violate it, see README), rows == distinct seq, min version >= 1.
select 'constraint' as check, c.conname::text as item,
       case when c.convalidated then 'validated' else 'NOT VALID: legacy rows violate it (new writes still checked)' end as result
  from pg_constraint c where c.conrelid = 'public.records'::regclass and c.contype = 'c'
union all
select 'records', 'rows / distinct seq / min version',
       count(*) || ' / ' || count(distinct seq) || ' / ' || coalesce(min(version)::text, '-') from public.records
union all
select 'client privileges', 'authenticated can INSERT into records (must be false)',
       has_table_privilege('authenticated', 'public.records', 'INSERT')::text
union all
select 'backups', 'rows in record_backups', count(*)::text from public.record_backups
order by 1, 2;
