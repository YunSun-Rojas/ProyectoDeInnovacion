-- FASE 5: PROPUESTA NO APLICADA. Ejecutar solo con autorización.
-- Requiere Fases 2/3 y verificar políticas reales antes del despliegue.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ DECLARE t text; f record; c record; target regprocedure; BEGIN
 IF to_regprocedure('public.inventory_register_stock(uuid,bigint,bigint,text,integer,text)') IS NULL
 OR has_schema_privilege('authenticated','public','CREATE') OR has_schema_privilege('anon','public','CREATE') THEN
 RAISE EXCEPTION 'PHYSICAL_SCHEMA_DRIFT'; END IF;
 FOR f IN SELECT * FROM (VALUES
  ('public.inventory_register_stock(uuid,bigint,bigint,text,integer,text)','jsonb'::regtype),
  ('public.inventory_write_enabled()','boolean'::regtype),
  ('auth.uid()','uuid'::regtype)
 ) AS expected(signature,result_type) LOOP
  target := to_regprocedure(f.signature);
  IF target IS NULL OR (SELECT prorettype FROM pg_proc WHERE oid=target) IS DISTINCT FROM f.result_type THEN
   RAISE EXCEPTION 'PHYSICAL_SCHEMA_DRIFT: %',f.signature;
  END IF;
  IF f.signature LIKE 'public.%' AND
   (has_function_privilege('anon',target,'EXECUTE') OR NOT has_function_privilege('authenticated',target,'EXECUTE')
    OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=target)) <> 'postgres') THEN
   RAISE EXCEPTION 'PHYSICAL_PERMISSION_DRIFT: %',f.signature;
  END IF;
 END LOOP;
 -- Mismo criterio de deriva que Fase 2: exigir el cuerpo de Fase 3 auditado.
 IF md5(replace(pg_get_functiondef('public.inventory_register_stock(uuid,bigint,bigint,text,integer,text)'::regprocedure),chr(13),''))
  <> 'b50b9bea9bef4af739016743eece4ef7' THEN
  RAISE EXCEPTION 'PHYSICAL_SCHEMA_DRIFT: cuerpo inventory_register_stock diferente';
 END IF;
 FOR c IN SELECT * FROM (VALUES
  ('public.products','id','bigint'::regtype,true),
  ('public.products','stock','integer'::regtype,true),
  ('public.products','version','bigint'::regtype,true),
  ('public.products','sku','text'::regtype,true),
  ('public.products','name','text'::regtype,true),
  ('public.products','updated_at','timestamp with time zone'::regtype,false),
  ('public.inventory_members','user_id','uuid'::regtype,true),
  ('public.inventory_movements','request_id','uuid'::regtype,true),
  ('auth.users','id','uuid'::regtype,true)
 ) AS expected(table_name,column_name,column_type,required) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(c.table_name)
   AND attname=c.column_name AND atttypid=c.column_type AND NOT attisdropped AND (NOT c.required OR attnotnull)) THEN
   RAISE EXCEPTION 'PHYSICAL_SCHEMA_DRIFT: %.%',c.table_name,c.column_name;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='auth.users'::regclass AND attname='email' AND NOT attisdropped)
 OR EXISTS(SELECT 1 FROM public.products WHERE stock<0 OR version<=0) THEN
  RAISE EXCEPTION 'PHYSICAL_SCHEMA_DRIFT: usuario o stock/version';
 END IF;
 FOREACH t IN ARRAY ARRAY['products','inventory_movements','inventory_members','inventory_sales'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass)
  OR has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
   RAISE EXCEPTION 'PHYSICAL_PERMISSION_DRIFT: %',t;
  END IF;
  IF has_any_column_privilege('authenticated','public.'||t,'INSERT,UPDATE')
   OR has_any_column_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE') THEN
   RAISE EXCEPTION 'PHYSICAL_PERMISSION_DRIFT: columnas %',t;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a
  ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
  WHERE i.indrelid='public.inventory_movements'::regclass AND i.indisunique AND i.indisvalid
  AND i.indpred IS NULL AND i.indnkeyatts=1 AND a.attname='request_id') THEN
  RAISE EXCEPTION 'PHYSICAL_SCHEMA_DRIFT: request_id debe ser único';
 END IF;
END $$;
CREATE TABLE public.inventory_counts (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, actor_email text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), observation text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'borrador' CHECK(status IN ('borrador','en revisión','finalizado','cancelado')),
 revision integer NOT NULL DEFAULT 1, finalized_at timestamptz,
 CHECK(length(observation)<=500)
);
CREATE TABLE public.inventory_count_lines (
 session_id uuid NOT NULL REFERENCES public.inventory_counts(id), product_id bigint NOT NULL,
 sku text NOT NULL, product_name text NOT NULL, reference_stock integer NOT NULL CHECK(reference_stock>=0),
 reference_version bigint NOT NULL CHECK(reference_version>0), physical_quantity integer CHECK(physical_quantity>=0),
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=400),
 movement_request uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 PRIMARY KEY(session_id,product_id)
);
CREATE INDEX inventory_counts_created_idx ON public.inventory_counts(created_at DESC);
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_counts,public.inventory_count_lines FROM public,anon,authenticated;
GRANT SELECT ON public.inventory_counts,public.inventory_count_lines TO authenticated;
-- Historial compartido intencionalmente entre miembros, igual que Movimientos/Kardex.
-- Únicamente el responsable puede guardar, revisar, cancelar o confirmar su sesión.
CREATE POLICY counts_read ON public.inventory_counts FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.inventory_members WHERE user_id=auth.uid()));
CREATE POLICY count_lines_read ON public.inventory_count_lines FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.inventory_members WHERE user_id=auth.uid()));
-- Un único contrato: todas las escrituras pasan por autenticación, revisión y bloqueo.
CREATE FUNCTION public.inventory_physical(p_action text,p_id uuid,p_revision integer DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid := auth.uid(); s public.inventory_counts%rowtype; l record; p public.products%rowtype;
 item jsonb; result jsonb; conflicts jsonb := '[]'; seen bigint[] := '{}'; product_key bigint;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.inventory_members WHERE user_id=actor)
 OR (p_action IS DISTINCT FROM 'get' AND public.inventory_write_enabled() IS DISTINCT FROM true) THEN
 RAISE EXCEPTION 'INVENTORY_FORBIDDEN' USING errcode='42501'; END IF;
 IF p_id IS NULL OR p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR p_action IS NULL OR p_action NOT IN ('create','save','review','reopen','rebase','confirm','cancel','get')
 OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
 RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode='22023'; END IF;
 IF p_action='create' AND p_data ? 'observation' AND
  (jsonb_typeof(p_data->'observation') IS DISTINCT FROM 'string' OR length(p_data->>'observation')>500) THEN
  RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('physical:'||p_id::text,0));
 SELECT * INTO s FROM public.inventory_counts WHERE id=p_id FOR UPDATE;
 IF p_action='create' THEN
  IF FOUND THEN
   IF s.actor_id<>actor OR s.observation IS DISTINCT FROM coalesce(p_data->>'observation','') THEN RAISE EXCEPTION 'INVENTORY_REQUEST_CONFLICT'; END IF;
  ELSE
   INSERT INTO public.inventory_counts(id,actor_id,actor_email,observation)
   SELECT p_id,actor,coalesce(email,actor::text),coalesce(p_data->>'observation','') FROM auth.users WHERE id=actor RETURNING * INTO s;
   INSERT INTO public.inventory_count_lines(session_id,product_id,sku,product_name,reference_stock,reference_version)
   SELECT p_id,id,sku,name,stock,version FROM public.products ORDER BY id;
   IF NOT FOUND THEN RAISE EXCEPTION 'PHYSICAL_EMPTY'; END IF;
  END IF;
 ELSIF s.id IS NULL THEN RAISE EXCEPTION 'INVENTORY_NOT_FOUND';
 END IF;
 IF p_action NOT IN ('get','create') THEN
  IF s.actor_id<>actor THEN RAISE EXCEPTION 'INVENTORY_FORBIDDEN' USING errcode='42501'; END IF;
  -- Confirmar de nuevo una sesión ya finalizada nunca vuelve a generar movimientos.
  IF NOT(p_action='confirm' AND s.status='finalizado') THEN
   IF s.status IN ('finalizado','cancelado') THEN RAISE EXCEPTION 'PHYSICAL_IMMUTABLE'; END IF;
   IF p_revision IS DISTINCT FROM s.revision THEN RAISE EXCEPTION 'PHYSICAL_STALE_REVISION'; END IF;
   IF p_action='save' THEN
    IF s.status<>'borrador' OR jsonb_typeof(p_data->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
    IF jsonb_array_length(p_data->'lines')=0 THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_data->'lines') LOOP
     IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(item->'productId') IS DISTINCT FROM 'number'
      OR (item->>'productId') !~ '^[0-9]+$' OR length(item->>'productId')>16
      OR (item->>'productId')::numeric NOT BETWEEN 1 AND 9007199254740991
      OR NOT (item ? 'quantity') OR jsonb_typeof(item->'quantity') NOT IN ('number','null')
      OR (jsonb_typeof(item->'quantity')='number' AND
       ((item->>'quantity') !~ '^[0-9]+$' OR length(item->>'quantity')>10 OR (item->>'quantity')::numeric>2147483647))
      OR (item ? 'reason' AND (jsonb_typeof(item->'reason') IS DISTINCT FROM 'string' OR length(item->>'reason')>400)) THEN
      RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode='22023';
     END IF;
     product_key := (item->>'productId')::bigint;
     IF product_key=ANY(seen) THEN RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode='22023'; END IF;
     seen := array_append(seen,product_key);
     UPDATE public.inventory_count_lines SET physical_quantity=(item->>'quantity')::integer,reason=coalesce(item->>'reason','')
      WHERE session_id=p_id AND product_id=product_key;
     IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_NOT_FOUND'; END IF;
    END LOOP;
   ELSIF p_action='review' THEN
    IF s.status<>'borrador' OR NOT EXISTS(SELECT 1 FROM public.inventory_count_lines WHERE session_id=p_id)
    OR EXISTS(SELECT 1 FROM public.inventory_count_lines WHERE session_id=p_id AND (physical_quantity IS NULL OR (physical_quantity<>reference_stock AND reason !~ '[^[:space:]]'))) THEN
     RAISE EXCEPTION 'PHYSICAL_INCOMPLETE: contar todos los productos e indicar motivos'; END IF;
    s.status := 'en revisión';
   ELSIF p_action='reopen' THEN
    IF s.status<>'en revisión' THEN RAISE EXCEPTION 'PHYSICAL_REVIEW_REQUIRED'; END IF;
    s.status := 'borrador';
   ELSIF p_action='cancel' THEN s.status := 'cancelado';
   ELSIF p_action IN ('rebase','confirm') THEN
    IF p_action='confirm' AND s.status<>'en revisión' THEN RAISE EXCEPTION 'PHYSICAL_REVIEW_REQUIRED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.inventory_count_lines WHERE session_id=p_id) THEN RAISE EXCEPTION 'PHYSICAL_EMPTY'; END IF;
    -- La RPC de stock toma request_id ANTES del producto: conservar ese orden.
    -- Evita invertir candados ante un envío directo del mismo request_id.
    IF p_action='confirm' THEN
     FOR l IN SELECT movement_request FROM public.inventory_count_lines WHERE session_id=p_id ORDER BY product_id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(l.movement_request::text,0));
     END LOOP;
    END IF;
    -- Orden estable y bloqueo de TODOS los productos, incluso coincidencias.
    FOR l IN SELECT * FROM public.inventory_count_lines WHERE session_id=p_id ORDER BY product_id LOOP
     SELECT * INTO p FROM public.products WHERE id=l.product_id FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'PHYSICAL_PRODUCT_REMOVED'; END IF;
     IF p.stock<>l.reference_stock OR p.version<>l.reference_version THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('sku',l.sku,'reference',l.reference_stock,'current',p.stock));
      IF p_action='rebase' THEN
       -- Exige volver a contar explícitamente los productos en conflicto.
       UPDATE public.inventory_count_lines SET reference_stock=p.stock,reference_version=p.version,
        physical_quantity=NULL,reason='' WHERE session_id=p_id AND product_id=p.id;
      END IF;
     END IF;
    END LOOP;
    IF p_action='confirm' THEN
     IF jsonb_array_length(conflicts)>0 THEN RETURN jsonb_build_object('conflicts',conflicts); END IF;
     FOR l IN SELECT * FROM public.inventory_count_lines WHERE session_id=p_id ORDER BY product_id LOOP
      IF l.physical_quantity IS NULL OR (l.physical_quantity<>l.reference_stock AND l.reason !~ '[^[:space:]]') THEN RAISE EXCEPTION 'PHYSICAL_INCOMPLETE'; END IF;
      IF l.physical_quantity<>l.reference_stock THEN
       result := public.inventory_register_stock(l.movement_request,l.product_id,l.reference_version,'stock_adjust',
        l.physical_quantity-l.reference_stock,'Inventario físico '||p_id::text||': '||l.reason);
      END IF;
     END LOOP;
     s.status := 'finalizado'; s.finalized_at := transaction_timestamp();
    ELSE s.status := 'borrador'; END IF;
   END IF;
   UPDATE public.inventory_counts SET status=s.status,revision=revision+1,finalized_at=s.finalized_at WHERE id=p_id RETURNING * INTO s;
  END IF;
 END IF;
 RETURN jsonb_build_object('session',to_jsonb(s),'lines',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY product_id)
 FROM public.inventory_count_lines x WHERE session_id=p_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.inventory_physical(text,uuid,integer,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.inventory_physical(text,uuid,integer,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
