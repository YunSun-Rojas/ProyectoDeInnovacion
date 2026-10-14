-- FASE 3: PROPUESTA NO APLICADA. Requiere autorización antes de Supabase.
-- Ensayar en copia aislada y respaldar esquema/datos antes del despliegue.
-- Aditiva: no reemplaza inventory_mutate, inventory_register_sale ni catalog_edit.
-- Requiere Fase 2 aplicada. No cambia productos ni historial preexistente.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE t text;
BEGIN
  IF to_regprocedure('public.inventory_mutate(uuid,text,bigint,bigint,jsonb)') IS NULL
    OR to_regprocedure('public.inventory_register_sale(uuid,bigint,bigint,integer,numeric)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.products'::regclass AND attname='updated_at' AND NOT attisdropped)
    OR has_schema_privilege('authenticated','public','CREATE')
    OR has_schema_privilege('anon','public','CREATE') THEN
    RAISE EXCEPTION 'STOCK_SCHEMA_DRIFT: revisar Fase 2 y permisos de public';
  END IF;
  FOREACH t IN ARRAY ARRAY['products','inventory_movements','inventory_members','inventory_sales'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass)
      OR has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'STOCK_PERMISSION_DRIFT: %',t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a
    ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid='public.inventory_movements'::regclass AND i.indisunique
      AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=1 AND a.attname='request_id') THEN
    RAISE EXCEPTION 'STOCK_SCHEMA_DRIFT: request_id debe ser único';
  END IF;
END
$preflight$;

CREATE FUNCTION public.inventory_register_stock(
  p_request_id uuid, p_product_id bigint, p_expected_version bigint,
  p_kind text, p_quantity integer, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  actor uuid := auth.uid();
  actor_name text;
  before_product public.products%rowtype;
  after_product public.products%rowtype;
  saved public.inventory_movements%rowtype;
  delta bigint;
  final_stock bigint;
  request jsonb := jsonb_build_object('action',p_kind,'product_id',p_product_id,
    'version',p_expected_version,'data',jsonb_build_object('quantity',p_quantity,'reason',p_reason));
BEGIN
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_members WHERE user_id=actor) THEN
    RAISE EXCEPTION 'INVENTORY_FORBIDDEN' USING errcode='42501';
  END IF;
  IF p_request_id IS NULL OR p_product_id IS NULL OR p_product_id<=0
    OR p_expected_version IS NULL OR p_expected_version<=0
    OR p_kind IS NULL OR p_kind NOT IN ('stock_in','stock_out','stock_adjust')
    OR p_quantity IS NULL OR p_quantity=0 OR p_quantity < -2147483647
    OR (p_kind <> 'stock_adjust' AND p_quantity<0)
    OR p_reason IS NULL OR p_reason !~ '[^[:space:]]' OR length(p_reason)>500 THEN
    RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode='22023';
  END IF;
  -- Mismo candado que las RPC existentes: un request_id no puede cruzar operaciones.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  SELECT * INTO saved FROM public.inventory_movements WHERE request_id=p_request_id;
  IF FOUND THEN
    IF saved.actor_id IS DISTINCT FROM actor OR saved.request_data IS DISTINCT FROM request THEN
      RAISE EXCEPTION 'INVENTORY_REQUEST_CONFLICT' USING errcode='22023';
    END IF;
    RETURN jsonb_build_object('product',saved.after_data,'movement',to_jsonb(saved));
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_sales WHERE id=p_request_id) THEN
    RAISE EXCEPTION 'INVENTORY_REQUEST_CONFLICT' USING errcode='22023';
  END IF;
  SELECT * INTO before_product FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_NOT_FOUND' USING errcode='P0002';
  END IF;
  IF before_product.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'INVENTORY_STALE_VERSION' USING errcode='40001';
  END IF;
  delta := CASE WHEN p_kind='stock_out' THEN -p_quantity::bigint ELSE p_quantity::bigint END;
  final_stock := before_product.stock::bigint + delta;
  IF final_stock<0 THEN
    RAISE EXCEPTION 'INVENTORY_NEGATIVE_STOCK' USING errcode='22023';
  END IF;
  IF final_stock>2147483647 THEN
    RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode='22023';
  END IF;
  SELECT coalesce(email,actor::text) INTO actor_name FROM auth.users WHERE id=actor;
  UPDATE public.products SET stock=final_stock::integer,version=version+1,
    updated_at=transaction_timestamp() WHERE id=p_product_id RETURNING * INTO after_product;
  INSERT INTO public.inventory_movements(request_id,request_data,product_id,product_name,sku,type,
    stock_before,stock_after,actor_id,actor_email,reason,before_data,after_data)
  VALUES(p_request_id,request,p_product_id,before_product.name,before_product.sku,
    CASE p_kind WHEN 'stock_in' THEN 'Entrada' WHEN 'stock_out' THEN 'Salida' ELSE 'Ajuste' END,
    before_product.stock,after_product.stock,actor,actor_name,btrim(p_reason),to_jsonb(before_product),to_jsonb(after_product))
  RETURNING * INTO saved;
  RETURN jsonb_build_object('product',to_jsonb(after_product),'movement',to_jsonb(saved));
END
$function$;

CREATE FUNCTION public.inventory_stock_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.inventory_members WHERE user_id=auth.uid());
$function$;
REVOKE ALL ON FUNCTION public.inventory_register_stock(uuid,bigint,bigint,text,integer,text) FROM public,anon;
REVOKE ALL ON FUNCTION public.inventory_stock_enabled() FROM public,anon;
GRANT EXECUTE ON FUNCTION public.inventory_register_stock(uuid,bigint,bigint,text,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_stock_enabled() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- Verificar permisos, reintentos, carreras con ventas y preservación de historial en copia.
-- Recuperación: ROLLBACK si falla antes de COMMIT; después, desactivar UI mediante
-- revocación de EXECUTE de inventory_stock_enabled con autorización. Conservar historial.
