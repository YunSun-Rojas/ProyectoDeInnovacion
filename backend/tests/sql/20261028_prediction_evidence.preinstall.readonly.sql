-- FASE 8: SOLO LECTURA. Copiar y ejecutar el archivo completo en una consulta propia.
-- Primero comprobar MANUALMENTE que la URL del Dashboard contiene:
-- /project/xuagxobtxsvssifrdknk/ y que pertenece a la organizacion correcta.
-- current_database() normalmente es postgres y NO identifica el proyecto.
-- Guardar los resultados en privado; no contienen filas ni credenciales.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL TIME ZONE 'UTC';

SELECT current_user AS execution_role, current_user = 'postgres' AS role_ok,
  current_database() AS database_name, current_setting('server_version') AS server_version,
  has_schema_privilege(current_user,'public','CREATE') AS can_create_public,
  has_schema_privilege(current_user,'auth','USAGE') AS can_use_auth,
  has_column_privilege(current_user,'auth.users','id','REFERENCES') AS can_reference_users,
  has_function_privilege(current_user,'auth.uid()','EXECUTE') AS can_execute_auth_uid;

-- Todas las filas deben mostrar absent = true. Cualquier colision detiene el plan.
WITH expected(name) AS (VALUES
  ('inventory_prediction_reviewers'), ('inventory_prediction_sale_reviews'),
  ('inventory_prediction_day_reviews'), ('inventory_prediction_sale_reviews_id_seq'),
  ('inventory_prediction_day_reviews_id_seq'), ('prediction_sale_reviews_latest_idx'),
  ('prediction_day_reviews_latest_idx'))
SELECT 'relation' AS object_type, e.name AS object_name,
  NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=e.name) AS absent
FROM expected e
UNION ALL
SELECT 'function', e.name,
  NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=e.name)
FROM (VALUES ('inventory_prediction_immutable'), ('inventory_prediction_classify_sale'),
  ('inventory_prediction_review_day'), ('inventory_prediction_evidence')) e(name)
ORDER BY object_type, object_name;

-- Comparar los cuatro conteos y huellas con el archivo posterior.
-- Son una comprobacion de cambios durante la ventana; NO son un respaldo.
-- auth.users se comprueba por metadatos, sin exigir SELECT sobre datos de Auth.
SELECT 'public.products' AS object_name, count(*) AS rows,
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS data_fingerprint FROM public.products t
UNION ALL SELECT 'public.inventory_sales', count(*),
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM public.inventory_sales t
UNION ALL SELECT 'public.inventory_movements', count(*),
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM public.inventory_movements t
UNION ALL SELECT 'public.inventory_members', count(*),
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id),'[]'::jsonb)::text) FROM public.inventory_members t
ORDER BY object_name;

-- Huella de permisos/RLS originales y defaults globales; comparar despues.
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
