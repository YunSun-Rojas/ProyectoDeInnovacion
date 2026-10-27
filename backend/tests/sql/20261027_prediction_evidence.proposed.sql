-- FASES 5/6: PROPUESTA PENDIENTE DE REVISION Y AUTORIZACION. NO APLICADA EN SUPABASE.
-- Antes de desplegar: comprobar esquema/propietario/ACL reales, respaldar y ensayar
-- en una copia aislada. Ejecutar como propietario de confianza, nunca desde UI.
-- No modifica ventas, productos, stock, movimientos, funciones existentes ni RLS
-- de otras tablas. No clasifica automaticamente ningun registro preexistente.
-- Los revisores los asigna/revoca exclusivamente el propietario; no se siembran.
-- Integracion posterior: backend autenticado lee inventory_prediction_evidence
-- y pasa el resultado como predictionEvidence, sin aceptar evidencia del cliente.
-- Ausencia de migracion/permiso debe bloquear prediccion, no romper inventario.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Despliegue previsto: SQL Editor con rol postgres, comprobado con el inspector.
-- Un rol con otro nombre requiere revisar el procedimiento, no quitar el control.
DO $$
DECLARE expected record; attribute smallint; relation regclass;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'PREDICTION_OWNER_REQUIRED';
  END IF;
  IF to_regclass('public.inventory_sales') IS NULL OR to_regclass('public.products') IS NULL
    OR to_regclass('public.inventory_members') IS NULL OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'PREDICTION_EXISTING_SCHEMA_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
    OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'PREDICTION_AUTH_SCHEMA_REQUIRED';
  END IF;
  IF (SELECT prorettype FROM pg_proc WHERE oid = 'auth.uid()'::regprocedure) <> 'uuid'::regtype
    OR NOT has_function_privilege(current_user, 'auth.uid()', 'EXECUTE')
    OR NOT has_column_privilege(current_user, 'auth.users', 'id', 'REFERENCES') THEN
    RAISE EXCEPTION 'PREDICTION_AUTH_SCHEMA_DRIFT';
  END IF;
  IF has_schema_privilege('anon','public','CREATE') OR has_schema_privilege('authenticated','public','CREATE')
    OR pg_has_role('anon','postgres','MEMBER') OR pg_has_role('authenticated','postgres','MEMBER')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'PREDICTION_UNSAFE_CLIENT_PRIVILEGES';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('public.products','id','bigint'),
    ('public.inventory_sales','id','uuid'),
    ('public.inventory_sales','product_id','bigint'),
    ('public.inventory_sales','created_at','timestamp with time zone'),
    ('public.inventory_members','user_id','uuid'),
    ('auth.users','id','uuid')
  ) AS required(table_name,column_name,type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(expected.table_name)
      AND attname = expected.column_name AND attnum > 0 AND NOT attisdropped
      AND atttypid = expected.type_name::regtype AND attnotnull) THEN
      RAISE EXCEPTION 'PREDICTION_COLUMN_DRIFT: %.%', expected.table_name, expected.column_name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES ('public.products','id'), ('public.inventory_sales','id'),
    ('public.inventory_members','user_id'), ('auth.users','id')) AS required(table_name,column_name) LOOP
    SELECT attnum INTO attribute FROM pg_attribute WHERE attrelid = to_regclass(expected.table_name) AND attname = expected.column_name;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass(expected.table_name)
      AND contype = 'p' AND conkey = ARRAY[attribute]) THEN
      RAISE EXCEPTION 'PREDICTION_PRIMARY_KEY_DRIFT: %', expected.table_name;
    END IF;
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['public.products'::regclass,'public.inventory_sales'::regclass,'public.inventory_members'::regclass] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = relation) THEN
      RAISE EXCEPTION 'PREDICTION_RLS_REQUIRED: %', relation;
    END IF;
    IF NOT has_table_privilege(current_user, relation, 'SELECT') THEN
      RAISE EXCEPTION 'PREDICTION_OWNER_READ_REQUIRED: %', relation;
    END IF;
  END LOOP;
  -- Una secuencia identity preexistente puede forzar un nombre autogenerado
  -- distinto. Evitar revocar por error la ACL de un objeto ajeno con ese nombre.
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN
      ('inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews',
       'inventory_prediction_sale_reviews_id_seq','inventory_prediction_day_reviews_id_seq',
       'prediction_sale_reviews_latest_idx','prediction_day_reviews_latest_idx'))
    OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
      ('inventory_prediction_immutable','inventory_prediction_classify_sale','inventory_prediction_review_day','inventory_prediction_evidence')) THEN
    RAISE EXCEPTION 'PREDICTION_OBJECTS_ALREADY_PRESENT';
  END IF;
END $$;

CREATE TABLE public.inventory_prediction_reviewers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.inventory_prediction_sale_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES public.inventory_sales(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('commercial', 'test', 'unclassified')),
  verified_at timestamptz NOT NULL,
  -- UUID historico: conservar autoria sin bloquear la baja futura de la cuenta.
  verified_by uuid NOT NULL,
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 500 AND reference ~ '[^[:space:]]')
);
CREATE INDEX prediction_sale_reviews_latest_idx ON public.inventory_prediction_sale_reviews (sale_id, verified_at DESC, id DESC);

-- Evidencia diaria por ID, sin FK a products: borrar/recrear un producto no
-- borra ni transfiere su evidencia. Registro completo != disponibilidad comercial.
CREATE TABLE public.inventory_prediction_day_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL CHECK (product_id > 0),
  day date NOT NULL CHECK (isfinite(day) AND day >= DATE '0001-01-01' AND day <= DATE '9998-12-31'),
  recording_complete boolean NOT NULL,
  availability text NOT NULL CHECK (availability IN ('available', 'stockout', 'unknown')),
  verified_at timestamptz NOT NULL,
  verified_by uuid NOT NULL,
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 500 AND reference ~ '[^[:space:]]')
);
CREATE INDEX prediction_day_reviews_latest_idx ON public.inventory_prediction_day_reviews (product_id, day, verified_at DESC, id DESC);

ALTER TABLE public.inventory_prediction_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_prediction_sale_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_prediction_day_reviews ENABLE ROW LEVEL SECURITY;
-- Ningun acceso directo ni politica que permita autoasignarse como revisor.
REVOKE ALL ON public.inventory_prediction_reviewers, public.inventory_prediction_sale_reviews,
  public.inventory_prediction_day_reviews FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.inventory_prediction_sale_reviews_id_seq,
  public.inventory_prediction_day_reviews_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.inventory_prediction_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'PREDICTION_APPEND_ONLY' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER prediction_sale_reviews_immutable BEFORE UPDATE OR DELETE ON public.inventory_prediction_sale_reviews
  FOR EACH ROW EXECUTE FUNCTION public.inventory_prediction_immutable();
CREATE TRIGGER prediction_day_reviews_immutable BEFORE UPDATE OR DELETE ON public.inventory_prediction_day_reviews
  FOR EACH ROW EXECUTE FUNCTION public.inventory_prediction_immutable();
-- TRUNCATE no dispara triggers por fila ni esta limitado por RLS.
CREATE TRIGGER prediction_sale_reviews_no_truncate BEFORE TRUNCATE ON public.inventory_prediction_sale_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_prediction_immutable();
CREATE TRIGGER prediction_day_reviews_no_truncate BEFORE TRUNCATE ON public.inventory_prediction_day_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_prediction_immutable();
-- Las correcciones son nuevos eventos. Se conserva todo el historial de auditoria.

CREATE FUNCTION public.inventory_prediction_classify_sale(p_sale_id uuid, p_kind text, p_reference text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); result_id bigint;
BEGIN
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_members WHERE user_id = actor)
    OR NOT EXISTS (SELECT 1 FROM public.inventory_prediction_reviewers WHERE user_id = actor) THEN
    RAISE EXCEPTION 'PREDICTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('commercial', 'test', 'unclassified')
    OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 500 OR p_reference !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'PREDICTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_sales WHERE id = p_sale_id) THEN
    RAISE EXCEPTION 'PREDICTION_SALE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.inventory_prediction_sale_reviews(sale_id,kind,verified_at,verified_by,reference)
    VALUES(p_sale_id,p_kind,clock_timestamp(),actor,btrim(p_reference)) RETURNING id INTO result_id;
  RETURN result_id;
END;
$$;

CREATE FUNCTION public.inventory_prediction_review_day(p_product_id bigint, p_day date,
  p_recording_complete boolean, p_availability text, p_reference text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); result_id bigint;
BEGIN
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_members WHERE user_id = actor)
    OR NOT EXISTS (SELECT 1 FROM public.inventory_prediction_reviewers WHERE user_id = actor) THEN
    RAISE EXCEPTION 'PREDICTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR p_product_id <= 0 OR p_day IS NULL OR NOT isfinite(p_day)
    OR p_day < DATE '0001-01-01' OR p_day > DATE '9998-12-31'
    OR p_day >= (statement_timestamp() AT TIME ZONE 'America/Lima')::date
    OR p_recording_complete IS NULL OR p_availability IS NULL
    OR p_availability NOT IN ('available', 'stockout', 'unknown')
    OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 500 OR p_reference !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'PREDICTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id)
    AND NOT EXISTS (SELECT 1 FROM public.inventory_sales WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'PREDICTION_PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.inventory_prediction_day_reviews(product_id,day,recording_complete,availability,verified_at,verified_by,reference)
    VALUES(p_product_id,p_day,p_recording_complete,p_availability,clock_timestamp(),actor,btrim(p_reference)) RETURNING id INTO result_id;
  RETURN result_id;
END;
$$;

-- Proyeccion de lectura compatible con preparePredictionData. No retorna motivos
-- libres, responsables ni datos de clientes. Los IDs de auditoria son referencias.
-- p_as_of limita la evidencia conocida; no inventa verificacion retrospectiva.
-- Guardar snapshots para una validacion prospectiva: el motor actual compara
-- retrospectivamente una fotografia auditada, no reproduce permisos del pasado.
CREATE FUNCTION public.inventory_prediction_evidence(p_as_of timestamptz DEFAULT statement_timestamp()) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_members WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'PREDICTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_as_of > statement_timestamp() THEN
    RAISE EXCEPTION 'PREDICTION_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  WITH sale_reviews AS (
    SELECT DISTINCT ON (r.sale_id) r.* FROM public.inventory_prediction_sale_reviews r
    JOIN public.inventory_sales s ON s.id = r.sale_id
    WHERE r.verified_at <= p_as_of AND s.created_at <= p_as_of
    ORDER BY r.sale_id, r.verified_at DESC, r.id DESC
  ), day_reviews AS (
    SELECT DISTINCT ON (product_id,day) * FROM public.inventory_prediction_day_reviews
    WHERE verified_at <= p_as_of AND day < (p_as_of AT TIME ZONE 'America/Lima')::date
    ORDER BY product_id, day, verified_at DESC, id DESC
  )
  SELECT jsonb_build_object(
    'classifications', (SELECT coalesce(jsonb_agg(jsonb_build_object('saleId',sale_id,'kind',kind,
      'evidence','sale-review:' || id::text,'verifiedAt',verified_at) ORDER BY sale_id),'[]'::jsonb) FROM sale_reviews),
    -- Solo registro completo Y disponibilidad confirmada habilitan ceros.
    'coverage', (SELECT coalesce(jsonb_agg(jsonb_build_object('productId',product_id,'from',day::text,'to',day::text,
      'evidence','day-review:' || id::text,'verifiedAt',verified_at) ORDER BY product_id,day),'[]'::jsonb)
      FROM day_reviews WHERE recording_complete AND availability = 'available'),
    'stockouts', (SELECT coalesce(jsonb_agg(jsonb_build_object('productId',product_id,'from',day::text,'to',day::text,
      'evidence','day-review:' || id::text,'verifiedAt',verified_at) ORDER BY product_id,day),'[]'::jsonb)
      FROM day_reviews WHERE availability = 'stockout')
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_prediction_immutable() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.inventory_prediction_classify_sale(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.inventory_prediction_review_day(bigint,date,boolean,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.inventory_prediction_evidence(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_prediction_classify_sale(uuid,text,text),
  public.inventory_prediction_review_day(bigint,date,boolean,text,text),
  public.inventory_prediction_evidence(timestamptz) TO authenticated;
-- REVOKE directo no elimina permisos heredados de otros roles ni demuestra
-- ausencia de privilegios por columna. Abortar, sin cambiar roles ni defaults
-- compartidos del proyecto, si la ACL efectiva no coincide con este contrato.
DO $$
DECLARE client text; relation regclass; routine regprocedure;
BEGIN
  FOREACH client IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH relation IN ARRAY ARRAY['public.inventory_prediction_reviewers'::regclass,
      'public.inventory_prediction_sale_reviews'::regclass,'public.inventory_prediction_day_reviews'::regclass] LOOP
      IF has_table_privilege(client,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(client,relation,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'PREDICTION_EFFECTIVE_ACL_DRIFT: % %', client, relation;
      END IF;
    END LOOP;
    IF has_sequence_privilege(client,'public.inventory_prediction_sale_reviews_id_seq','SELECT,USAGE,UPDATE')
      OR has_sequence_privilege(client,'public.inventory_prediction_day_reviews_id_seq','SELECT,USAGE,UPDATE') THEN
      RAISE EXCEPTION 'PREDICTION_EFFECTIVE_ACL_DRIFT: % sequences', client;
    END IF;
    FOREACH routine IN ARRAY ARRAY['public.inventory_prediction_immutable()'::regprocedure,
      'public.inventory_prediction_classify_sale(uuid,text,text)'::regprocedure,
      'public.inventory_prediction_review_day(bigint,date,boolean,text,text)'::regprocedure,
      'public.inventory_prediction_evidence(timestamptz)'::regprocedure] LOOP
      IF has_function_privilege(client,routine,'EXECUTE') IS DISTINCT FROM
        (client = 'authenticated' AND routine <> 'public.inventory_prediction_immutable()'::regprocedure) THEN
        RAISE EXCEPTION 'PREDICTION_EFFECTIVE_ACL_DRIFT: % %', client, routine;
      END IF;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
