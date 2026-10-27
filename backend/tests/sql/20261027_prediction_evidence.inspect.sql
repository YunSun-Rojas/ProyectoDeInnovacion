-- INSPECCION MANUAL: solo SELECT sobre catalogos; sin filas, IDs de usuarios,
-- credenciales o datos comerciales. Ejecutar antes y despues en SQL Editor.
-- No aplica migraciones ni asigna revisores. Guardar resultados en privado.

SELECT current_user AS execution_role, current_setting('server_version') AS server_version,
  current_setting('TimeZone') AS session_timezone,
  (statement_timestamp() AT TIME ZONE 'America/Lima')::date AS lima_today;

SELECT expected.name AS role_name, r.oid IS NOT NULL AS present, r.rolsuper,
  r.rolbypassrls, r.rolcanlogin, r.rolinherit,
  CASE WHEN r.oid IS NOT NULL THEN has_schema_privilege(r.oid,'public','CREATE') END AS can_create_public,
  CASE WHEN r.oid IS NOT NULL THEN pg_has_role(r.oid,'postgres','MEMBER') END AS member_of_postgres
FROM (VALUES ('postgres'),('anon'),('authenticated'),('service_role')) expected(name)
LEFT JOIN pg_roles r ON r.rolname = expected.name ORDER BY expected.name;

WITH expected(schema_name,table_name) AS (VALUES
  ('public','products'),('public','inventory_sales'),('public','inventory_movements'),('public','inventory_members'),('auth','users'),
  ('public','inventory_prediction_reviewers'),('public','inventory_prediction_sale_reviews'),('public','inventory_prediction_day_reviews'))
SELECT e.schema_name,e.table_name,c.oid IS NOT NULL AS present,c.relkind,
  pg_get_userbyid(c.relowner) AS owner_role,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced
FROM expected e LEFT JOIN pg_namespace n ON n.nspname=e.schema_name
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name ORDER BY e.schema_name,e.table_name;

SELECT n.nspname AS schema_name,c.relname AS table_name,a.attname AS column_name,
  format_type(a.atttypid,a.atttypmod) AS column_type,a.attnotnull AS not_null,a.attidentity AS identity_kind
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE a.attnum>0 AND NOT a.attisdropped AND (
  (n.nspname='public' AND c.relname IN ('products','inventory_sales','inventory_movements','inventory_members',
    'inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews'))
  OR (n.nspname='auth' AND c.relname='users' AND a.attname='id'))
ORDER BY n.nspname,c.relname,a.attnum;

SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname,k.contype,
  pg_get_constraintdef(k.oid,true) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='public' AND c.relname IN ('products','inventory_sales','inventory_movements','inventory_members',
  'inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews'))
  OR (n.nspname='auth' AND c.relname='users' AND k.contype='p')
ORDER BY n.nspname,c.relname,k.conname;

SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('products','inventory_sales','inventory_movements','inventory_members',
  'inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews')
ORDER BY tablename,indexname;

-- Los predicados no se imprimen: podrian contener identificadores literales.
-- Revisar sus expresiones completas localmente en SQL Editor antes de autorizar;
-- los booleanos y huellas de abajo no demuestran que una politica sea correcta.
SELECT c.relname AS table_name,p.polname,p.polcmd,p.polpermissive,p.polroles,
  md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')) AS using_fingerprint,
  md5(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) AS check_fingerprint
FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('products','inventory_sales','inventory_movements','inventory_members',
  'inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews')
ORDER BY c.relname,p.polname;

SELECT n.nspname AS schema_name,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type,pg_get_userbyid(p.proowner) AS owner_role,
  p.prosecdef AS security_definer,p.provolatile,p.proconfig,
  md5(pg_get_functiondef(p.oid)) AS definition_fingerprint,
  r.rolname AS caller_role,has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN pg_roles r
WHERE r.rolname IN ('anon','authenticated','service_role','postgres') AND (
  (n.nspname='auth' AND p.proname='uid') OR (n.nspname='public' AND p.proname IN
    ('inventory_write_enabled','inventory_sales_enabled','inventory_register_sale','inventory_register_stock',
     'inventory_prediction_immutable','inventory_prediction_classify_sale','inventory_prediction_review_day','inventory_prediction_evidence')))
ORDER BY n.nspname,p.proname,arguments,r.rolname;

SELECT c.relname AS object_name,c.relkind,r.rolname AS caller_role,
  CASE WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'USAGE') ELSE has_table_privilege(r.oid,c.oid,'SELECT') END AS can_read_or_use,
  CASE WHEN c.relkind<>'S' THEN has_table_privilege(r.oid,c.oid,'INSERT') END AS can_insert,
  CASE WHEN c.relkind<>'S' THEN has_table_privilege(r.oid,c.oid,'UPDATE') END AS can_update,
  CASE WHEN c.relkind<>'S' THEN has_table_privilege(r.oid,c.oid,'DELETE') END AS can_delete,
  CASE WHEN c.relkind<>'S' THEN has_table_privilege(r.oid,c.oid,'TRUNCATE') END AS can_truncate
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
WHERE n.nspname='public' AND c.relkind IN ('r','p','S')
  AND c.relname IN ('products','inventory_sales','inventory_movements','inventory_members',
    'inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews',
    'inventory_prediction_sale_reviews_id_seq','inventory_prediction_day_reviews_id_seq')
  AND r.rolname IN ('anon','authenticated','service_role','postgres') ORDER BY c.relname,r.rolname;

SELECT c.relname AS table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN
  ('inventory_prediction_sale_reviews','inventory_prediction_day_reviews') ORDER BY c.relname,t.tgname;

-- Detecta tambien concesiones inesperadas a PUBLIC u otros roles (sin nombres
-- personales). Es necesario revisar herencias; una ACL directa no basta.
SELECT c.relname AS object_name,CASE WHEN a.grantee=0 THEN 'PUBLIC'
  WHEN r.rolname IN ('postgres','anon','authenticated','service_role') THEN r.rolname ELSE 'other_role' END AS grantee_kind,
  a.privilege_type,a.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
LEFT JOIN pg_roles r ON r.oid=a.grantee
WHERE n.nspname='public' AND c.relkind IN ('r','S') AND c.relname IN
  ('inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews',
   'inventory_prediction_sale_reviews_id_seq','inventory_prediction_day_reviews_id_seq') ORDER BY c.relname,grantee_kind,a.privilege_type;

-- SEGURIDAD PENDIENTE - ejecutar solo desde aqui si tipos/PK/propietarios ya
-- fueron confirmados. Estas consultas no escriben ni repiten esos controles.
-- S0: permisos necesarios del rol de despliegue, con REFERENCES solo sobre id.
SELECT current_user AS deployment_role,has_schema_privilege(current_user,'public','CREATE') AS can_create_public,
  has_schema_privilege(current_user,'auth','USAGE') AS can_use_auth,
  has_column_privilege(current_user,'auth.users','id','REFERENCES') AS can_reference_auth_id,
  has_function_privilege(current_user,'auth.uid()','EXECUTE') AS can_execute_auth_uid;
-- S1: herencias directas/indirectas y privilegios disponibles sin SET ROLE.
SELECT client.rolname AS client_role,parent.oid AS inherited_role_oid,
  CASE WHEN parent.rolname IN ('postgres','anon','authenticated','service_role') THEN parent.rolname ELSE 'other_role' END AS inherited_role_kind,
  pg_has_role(client.oid,parent.oid,'USAGE') AS privileges_inherited,
  parent.rolsuper,parent.rolbypassrls,parent.rolcreaterole,parent.rolcreatedb
FROM pg_roles client CROSS JOIN pg_roles parent
WHERE client.rolname IN ('anon','authenticated','service_role') AND parent.oid<>client.oid
  AND pg_has_role(client.oid,parent.oid,'MEMBER') ORDER BY client.rolname,parent.oid;

-- S2: defaults de postgres globales y en public que afectarian objetos nuevos.
SELECT coalesce(n.nspname,'GLOBAL') AS scope,d.defaclobjtype,
  CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN r.rolname IN ('postgres','anon','authenticated','service_role') THEN r.rolname ELSE 'other_role' END AS grantee_kind,
  a.grantee AS grantee_role_oid,a.privilege_type,a.is_grantable
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
WHERE d.defaclrole='postgres'::regrole AND (d.defaclnamespace=0 OR n.nspname='public')
  AND d.defaclobjtype IN ('r','S','f') ORDER BY scope,d.defaclobjtype,a.grantee,a.privilege_type;

-- S3: privilegios efectivos por columna, separados de los permisos de tabla.
SELECT c.relname AS table_name,a.attname AS column_name,r.rolname AS caller_role,
  has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') AS can_select,
  has_column_privilege(r.oid,c.oid,a.attnum,'INSERT') AS can_insert,
  has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE') AS can_update,
  has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES') AS can_reference
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname='public'
  AND c.relname IN ('inventory_members','inventory_sales','inventory_prediction_reviewers',
    'inventory_prediction_sale_reviews','inventory_prediction_day_reviews')
  AND r.rolname IN ('anon','authenticated','service_role') ORDER BY c.relname,a.attnum,r.rolname;

-- S4: concesiones de columna explicitas, incluyendo PUBLIC. Una consulta vacia
-- antes de crear las tablas nuevas no demuestra cuales seran sus ACL futuras.
SELECT c.relname AS table_name,a.attname AS column_name,
  CASE WHEN acl.grantee=0 THEN 'PUBLIC' WHEN r.rolname IN ('postgres','anon','authenticated','service_role') THEN r.rolname ELSE 'other_role' END AS grantee_kind,
  acl.grantee AS grantee_role_oid,acl.privilege_type,acl.is_grantable
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(a.attacl) acl LEFT JOIN pg_roles r ON r.oid=acl.grantee
WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname='public'
  AND c.relname IN ('inventory_members','inventory_sales','inventory_prediction_reviewers',
    'inventory_prediction_sale_reviews','inventory_prediction_day_reviews') ORDER BY c.relname,a.attnum,acl.grantee;

-- S5: colisiones, definidores/search_path y EXECUTE explicito (tambien PUBLIC).
-- Antes del despliegue no deben existir los objetos public de prediccion.
-- auth.uid() ya existe: se inspeccionan solo propietario y privilegios.
SELECT c.relname,c.relkind FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN
  ('inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews',
   'inventory_prediction_sale_reviews_id_seq','inventory_prediction_day_reviews_id_seq',
   'prediction_sale_reviews_latest_idx','prediction_day_reviews_latest_idx') ORDER BY c.relname;
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner_role,p.prosecdef,p.proconfig,
  CASE WHEN acl.grantee=0 THEN 'PUBLIC' WHEN r.rolname IN ('postgres','anon','authenticated','service_role') THEN r.rolname ELSE 'other_role' END AS grantee_kind,
  acl.grantee AS grantee_role_oid,acl.privilege_type,acl.is_grantable
FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
LEFT JOIN pg_roles r ON r.oid=acl.grantee
WHERE (p.pronamespace='public'::regnamespace AND p.proname IN
  ('inventory_prediction_immutable','inventory_prediction_classify_sale','inventory_prediction_review_day','inventory_prediction_evidence'))
  OR (p.pronamespace='auth'::regnamespace AND p.proname='uid' AND p.pronargs=0)
ORDER BY p.proname,arguments,acl.grantee;

-- S6: predicados RLS para revision local, con UUID/correos literales ocultos.
-- La redaccion no sustituye revisar el original privadamente en SQL Editor.
SELECT c.relname AS table_name,p.polname,p.polcmd,p.polpermissive,p.polroles,
  regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual,p.polrelid),''),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','[redacted UUID]','gi'),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[redacted email]','g') AS using_expression,
  regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','[redacted UUID]','gi'),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[redacted email]','g') AS check_expression
FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
WHERE c.relnamespace='public'::regnamespace AND c.relname IN
  ('inventory_members','inventory_sales','inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews')
ORDER BY c.relname,p.polname;
