-- A CRM opportunity may represent more than one vehicle. Keep projection_id
-- as the independent row identity and remove only unique constraints/indexes
-- on weekly_sales_projection that enforce uniqueness through CRM.
DO $migration$
DECLARE
  crm_attnum smallint;
  candidate record;
  removed_count integer := 0;
BEGIN
  SELECT attnum
    INTO crm_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.weekly_sales_projection'::regclass
     AND attname = 'crm_opportunity_id'
     AND NOT attisdropped;

  IF crm_attnum IS NULL THEN
    RAISE EXCEPTION 'weekly_sales_projection.crm_opportunity_id was not found';
  END IF;

  FOR candidate IN
    SELECT con.conname AS object_name, 'constraint' AS object_type, NULL::text AS schema_name
      FROM pg_constraint con
     WHERE con.conrelid = 'public.weekly_sales_projection'::regclass
       AND con.contype = 'u'
       AND crm_attnum = ANY(con.conkey)
    UNION ALL
    SELECT idx.relname AS object_name, 'index' AS object_type, ns.nspname AS schema_name
      FROM pg_index ix
      JOIN pg_class idx ON idx.oid = ix.indexrelid
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
     WHERE ix.indrelid = 'public.weekly_sales_projection'::regclass
       AND ix.indisunique
       AND NOT ix.indisprimary
       AND crm_attnum = ANY((ix.indkey::smallint[])[1:ix.indnkeyatts])
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid
       )
  LOOP
    IF candidate.object_type = 'constraint' THEN
      EXECUTE format(
        'ALTER TABLE public.weekly_sales_projection DROP CONSTRAINT %I',
        candidate.object_name
      );
    ELSE
      EXECUTE format('DROP INDEX %I.%I', candidate.schema_name, candidate.object_name);
    END IF;
    removed_count := removed_count + 1;
    RAISE NOTICE 'Removed CRM uniqueness rule: % (%)', candidate.object_name, candidate.object_type;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_index ix
     WHERE ix.indrelid = 'public.weekly_sales_projection'::regclass
       AND ix.indisunique
       AND NOT ix.indisprimary
       AND crm_attnum = ANY((ix.indkey::smallint[])[1:ix.indnkeyatts])
  ) THEN
    RAISE EXCEPTION 'A unique index still prevents multiple projections per CRM';
  END IF;

  RAISE NOTICE 'CRM uniqueness migration complete; removed % rule(s)', removed_count;
END
$migration$;
