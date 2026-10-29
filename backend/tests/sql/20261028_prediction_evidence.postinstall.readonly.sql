-- FASE 8: SOLO LECTURA. Ejecutar completo, DESPUES de una instalacion autorizada.
-- No asigna revisores ni llama a RPC de escritura. No ensayar ataques DML en produccion.
-- Verificar de nuevo /project/xuagxobtxsvssifrdknk/ en la URL del Dashboard.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL TIME ZONE 'UTC';
SELECT current_user AS execution_role, current_user = 'postgres' AS role_ok;

-- Las siete filas deben tener present = true y definition_ok = true.
WITH expected(name,kind) AS (VALUES
  ('inventory_prediction_reviewers','r'), ('inventory_prediction_sale_reviews','r'),
  ('inventory_prediction_day_reviews','r'), ('inventory_prediction_sale_reviews_id_seq','S'),
  ('inventory_prediction_day_reviews_id_seq','S'), ('prediction_sale_reviews_latest_idx','i'),
  ('prediction_day_reviews_latest_idx','i'))
SELECT e.name AS object_name, c.oid IS NOT NULL AS present,
  coalesce(c.relkind::text=e.kind AND pg_get_userbyid(c.relowner)='postgres'
    AND CASE WHEN e.kind='r' THEN c.relrowsecurity ELSE true END,false) AS definition_ok
FROM expected e LEFT JOIN pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=e.name
ORDER BY e.name;

-- Esperados: constraints=11 (PK/FK/CHECK, sin contar NOT NULL), audit_triggers=4,
-- unexpected_policies=0. Se cuentan explicitamente PK/FK/CHECK.
SELECT (SELECT count(*) FROM pg_constraint WHERE contype IN ('p','f','c') AND conrelid IN
    ('public.inventory_prediction_reviewers'::regclass,'public.inventory_prediction_sale_reviews'::regclass,
     'public.inventory_prediction_day_reviews'::regclass)) AS constraints,
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
    AND tgrelid IN ('public.inventory_prediction_sale_reviews'::regclass,'public.inventory_prediction_day_reviews'::regclass)) AS audit_triggers,
  (SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.inventory_prediction_reviewers'::regclass,
    'public.inventory_prediction_sale_reviews'::regclass,'public.inventory_prediction_day_reviews'::regclass)) AS unexpected_policies;

-- Cuatro filas; TODAS las columnas *_ok deben ser true.
SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_userbyid(p.proowner)='postgres' AS owner_ok,
  coalesce(p.proconfig @> ARRAY['search_path=""'],false) AS search_path_ok,
  p.prosecdef=(p.proname<>'inventory_prediction_immutable') AS security_definer_ok,
  has_function_privilege('authenticated',p.oid,'EXECUTE')=(p.proname<>'inventory_prediction_immutable') AS authenticated_execute_ok,
  NOT has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute_ok,
  NOT has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute_ok,
  NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute_ok
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
  ('inventory_prediction_immutable','inventory_prediction_classify_sale','inventory_prediction_review_day','inventory_prediction_evidence')
ORDER BY p.proname;

-- Quince filas (cinco objetos por tres roles); TODAS deben tener denied = true.
SELECT c.relname AS object_name, r.rolname AS client_role,
  CASE WHEN c.relkind='S' THEN NOT has_sequence_privilege(r.oid,c.oid,'SELECT,USAGE,UPDATE')
    ELSE NOT (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) END AS denied
FROM pg_class c CROSS JOIN pg_roles r
WHERE c.oid IN ('public.inventory_prediction_reviewers'::regclass,'public.inventory_prediction_sale_reviews'::regclass,
  'public.inventory_prediction_day_reviews'::regclass,'public.inventory_prediction_sale_reviews_id_seq'::regclass,
  'public.inventory_prediction_day_reviews_id_seq'::regclass)
  AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY c.relname,r.rolname;

-- Esperado: cero filas de evidencia y cero revisores.
SELECT 'reviewers' AS object_name,count(*) AS rows FROM public.inventory_prediction_reviewers
UNION ALL SELECT 'sale_reviews',count(*) FROM public.inventory_prediction_sale_reviews
UNION ALL SELECT 'day_reviews',count(*) FROM public.inventory_prediction_day_reviews;

-- Los conteos Y huellas deben coincidir con la lectura previa.
SELECT 'public.products' AS object_name, count(*) AS rows,
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS data_fingerprint FROM public.products t
UNION ALL SELECT 'public.inventory_sales', count(*),
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM public.inventory_sales t
UNION ALL SELECT 'public.inventory_movements', count(*),
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM public.inventory_movements t
UNION ALL SELECT 'public.inventory_members', count(*),
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id),'[]'::jsonb)::text) FROM public.inventory_members t
ORDER BY object_name;

WITH originals AS (SELECT c.* FROM pg_class c WHERE c.oid IN
  ('public.products'::regclass,'public.inventory_sales'::regclass,'public.inventory_movements'::regclass,
   'public.inventory_members'::regclass,'auth.users'::regclass))
SELECT md5(jsonb_build_object(
  'tables',(SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity) ORDER BY oid) FROM originals),
  'columns',(SELECT jsonb_agg(jsonb_build_array(attrelid,attnum,attacl) ORDER BY attrelid,attnum) FROM pg_attribute
    WHERE attrelid IN (SELECT oid FROM originals) AND attnum>0 AND NOT attisdropped),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p WHERE polrelid IN (SELECT oid FROM originals)),
  'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d)
)::text) AS original_security_fingerprint;
COMMIT;
