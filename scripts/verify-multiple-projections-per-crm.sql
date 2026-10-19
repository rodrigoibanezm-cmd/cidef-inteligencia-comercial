-- Integration check: create two rows for one CRM, update one, read both,
-- and roll back the transaction so no projection data persists.
BEGIN;
DO $verification$
DECLARE
  v_week date := date_trunc('week', CURRENT_DATE)::date;
  v_date date := date_trunc('week', CURRENT_DATE)::date + 4;
  v_branch bigint;
  v_person bigint;
  v_model_1 bigint;
  v_model_2 bigint;
  v_crm public.weekly_sales_projection.crm_opportunity_id%TYPE;
  v_id_1 bigint;
  v_id_2 bigint;
  v_count integer;
  v_units integer;
BEGIN
  SELECT wps.sucursal_id, wps.persona_id
    INTO v_branch, v_person
    FROM weekly_projection_sellers wps
    JOIN sucursales_master sm ON sm.sucursal_id = wps.sucursal_id
    JOIN persona_sucursal ps ON ps.persona_id = wps.persona_id
                              AND ps.sucursal_id = wps.sucursal_id
                              AND ps.rol = 'VENDEDOR_TIENDA'
                              AND ps.vigente = true
    LEFT JOIN persona_estado_comercial pec ON pec.persona_id = wps.persona_id
   WHERE COALESCE(pec.vigente_fuerza_venta, true) = true
     AND wps.habilitado = true
     AND wps.estado = 'ACTIVO'
     AND wps.persona_id IS NOT NULL
     AND sm.vigente = true
     AND sm.tipo_canal = 'CIDEF'
   ORDER BY wps.seller_id
   LIMIT 1;

  SELECT min(modelo_id)
    INTO v_model_1
    FROM producto_portafolio_v01
   WHERE vigente = true AND organizacion = 'CIDEF';

  SELECT min(modelo_id)
    INTO v_model_2
    FROM producto_portafolio_v01
   WHERE vigente = true AND organizacion = 'CIDEF'
     AND modelo_id > v_model_1;

  SELECT "ID"::text
    INTO v_crm
    FROM "CRM_Cidef_raw"
   ORDER BY "ID" DESC
   LIMIT 1;

  IF v_branch IS NULL OR v_person IS NULL OR v_model_1 IS NULL OR v_crm IS NULL THEN
    RAISE EXCEPTION 'Could not find active projection dimensions and a CRM row for verification';
  END IF;
  v_model_2 := COALESCE(v_model_2, v_model_1);

  INSERT INTO weekly_sales_projection
    (week_start, sucursal_id, persona_id, modelo_id, version_id, projected_units,
     expected_close_date, crm_opportunity_id, crm_link_method, updated_at)
  VALUES
    (v_week, v_branch, v_person, v_model_1, NULL, 1, v_date, v_crm, 'SUGGESTED', now())
  RETURNING projection_id INTO v_id_1;

  INSERT INTO weekly_sales_projection
    (week_start, sucursal_id, persona_id, modelo_id, version_id, projected_units,
     expected_close_date, crm_opportunity_id, crm_link_method, updated_at)
  VALUES
    (v_week, v_branch, v_person, v_model_2, NULL, 1, v_date + 1, v_crm, 'SUGGESTED', now())
  RETURNING projection_id INTO v_id_2;

  UPDATE weekly_sales_projection
     SET expected_close_date = v_date + 2, updated_at = now()
   WHERE projection_id = v_id_2 AND crm_opportunity_id = v_crm;

  SELECT count(*)::integer, COALESCE(sum(projected_units), 0)::integer
    INTO v_count, v_units
    FROM weekly_sales_projection
   WHERE projection_id IN (v_id_1, v_id_2)
     AND crm_opportunity_id = v_crm;

  IF v_id_1 = v_id_2 OR v_count <> 2 OR v_units <> 2 THEN
    RAISE EXCEPTION 'Expected two independent one-unit projections for CRM %, found rows=% units=%', v_crm, v_count, v_units;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM weekly_sales_projection
     WHERE projection_id = v_id_2 AND expected_close_date = v_date + 2
  ) THEN
    RAISE EXCEPTION 'Projection update did not persist inside the verification transaction';
  END IF;

  RAISE NOTICE 'PASS: two distinct projection rows share CRM %, one row updated, total units=2; transaction will roll back', v_crm;
END
$verification$;
ROLLBACK;
