-- FASE 2: PROPUESTA DEFINITIVA PARA REVISION Y AUTORIZACION. NO APLICADA.
-- Fuentes: estructura_products.csv y Supabase Snippet Untitled query (1).csv,
-- leídos directamente de Downloads el 2026-10-13; sin copiar CSV al repositorio.
-- Todos los miembros pueden consultar costos y escribir mediante RPC existentes.
-- Se conservan ACL/RLS. No se conceden permisos adicionales ni se crean roles.
-- source_status: valores exportados "Datos Correcto"/vacío; sin uso operativo
-- en el código revisado. Se conserva; is_active es un estado administrativo distinto.
--
-- PREPARACION OBLIGATORIA ANTES DE PRODUCCION (no ejecutada por Codex):
-- 1. Respaldo consistente de esquema y datos (incluidas secuencias y roles/ACL),
--    products, inventory_movements, inventory_sales, inventory_members y categories.
--    Guardar también pg_get_functiondef de las cuatro funciones y probar restauración.
-- 2. Capturar filas/IDs/SKU/stock/price/version y ventas/movimientos para comparación.
-- 3. Ensayar este archivo en copia aislada; suspender escrituras durante despliegue
--    y comparación. No usar productos de producción para las pruebas funcionales.
-- 4. Autorizar explícitamente la aplicación. No activar nuevos campos en API/UI
--    hasta confirmar que COMMIT terminó correctamente y se verificaron permisos.
--
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Preflight: detiene si la definición o permisos cambiaron desde la exportación.
-- No es una autorización automática para ejecutar este archivo.
DO $preflight$
DECLARE f record; target regprocedure; t text;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.inventory_mutate(uuid,text,bigint,bigint,jsonb)', 'c7b8dceb48a1c0b3ba53f931d6209b3c'),
    ('public.inventory_register_sale(uuid,bigint,bigint,integer,numeric)', '191319f8bc2228678a8d40b75779fd00'),
    ('public.inventory_sales_enabled()', 'f556204d901b4c9416169297e2c4318c'),
    ('public.inventory_write_enabled()', '95c49135bf3935929263241f12ff1480')
  ) AS expected(signature, digest) LOOP
    target := to_regprocedure(f.signature);
    IF target IS NULL OR md5(replace(pg_get_functiondef(target), chr(13), '')) <> f.digest THEN
      RAISE EXCEPTION 'CATALOG_SCHEMA_DRIFT: función diferente %', f.signature;
    END IF;
    IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = target)) <> 'postgres'
      OR has_function_privilege('anon', target, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', target, 'EXECUTE') THEN
      RAISE EXCEPTION 'CATALOG_PERMISSION_DRIFT: %', f.signature;
    END IF;
  END LOOP;
  IF (SELECT attidentity FROM pg_attribute WHERE attrelid = 'public.products'::regclass AND attname = 'id') IS DISTINCT FROM 'd'
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.products'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'CATALOG_SCHEMA_DRIFT: identity o triggers';
  END IF;
  FOREACH t IN ARRAY ARRAY['products', 'inventory_members', 'inventory_movements', 'inventory_sales'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass)
      OR has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'CATALOG_PERMISSION_DRIFT: tabla %', t;
    END IF;
  END LOOP;
END
$preflight$;

-- Las seis columnas estaban ausentes en los CSV. Si alguna ya existe, abortar
-- y comprobar su definición, en lugar de ocultar diferencias con IF NOT EXISTS.
ALTER TABLE public.products
  ADD COLUMN barcode text NULL,
  ADD COLUMN purchase_cost numeric NULL,
  ADD COLUMN unit_of_measure text NOT NULL DEFAULT 'Unidad',
  ADD COLUMN image_path text NULL,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN updated_at timestamptz NULL;
ALTER TABLE public.products ALTER COLUMN updated_at SET DEFAULT transaction_timestamp();
ALTER TABLE public.products
  ADD CONSTRAINT products_catalog_barcode_check
    CHECK (barcode IS NULL OR (length(barcode) BETWEEN 1 AND 100 AND btrim(barcode) <> '')),
  ADD CONSTRAINT products_catalog_purchase_cost_check
    CHECK (purchase_cost IS NULL OR
      (purchase_cost >= 0 AND purchase_cost < 10000000000
       AND purchase_cost <> 'NaN'::numeric AND round(purchase_cost, 2) = purchase_cost)),
  ADD CONSTRAINT products_catalog_unit_check
    CHECK (length(unit_of_measure) BETWEEN 1 AND 40 AND btrim(unit_of_measure) <> '');

-- Numeric sin typmod: rechaza >2 decimales sin redondearlos antes del CHECK.
-- updated_at permanece NULL para registros anteriores; no se inventan fechas.
-- No se cambia ningún valor de ID/SKU/stock/price/version/source_status.
-- CREATE OR REPLACE conserva firma, propietario y permisos de ejecución.
-- updated_at se actualiza por esta RPC; no se introduce un trigger adicional.
-- La función de ventas exportada se mantiene EXACTAMENTE igual.

CREATE OR REPLACE FUNCTION public.inventory_mutate(p_request_id uuid, p_action text, p_product_id bigint, p_expected_version bigint, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  actor_name text;
  registered_by text;
  before_product public.products%rowtype;
  after_product public.products%rowtype;
  saved public.inventory_movements%rowtype;

  request jsonb := jsonb_build_object(
    'action', p_action,
    'product_id', p_product_id,
    'version', p_expected_version,
    'data', p_data
  );

  movement_type text;
  movement_reason text;
  requested_stock numeric;
  requested_min numeric;
  requested_price numeric;
  category bigint;
  delta integer;
  attribute_name text;
  attribute_limit integer;

BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.inventory_members
    WHERE user_id = actor
  ) THEN
    RAISE EXCEPTION 'INVENTORY_FORBIDDEN'
      USING errcode = '42501';
  END IF;

  IF p_request_id IS NULL
    OR p_action IS NULL
    OR p_action NOT IN ('add', 'edit', 'catalog_edit', 'delete', 'adjust')
    OR p_data IS NULL
    OR jsonb_typeof(p_data) <> 'object'
  THEN
    RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'
      USING errcode = '22023';
  END IF;

  -- Evita movimientos duplicados al reintentar.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_request_id::text, 0)
  );

  SELECT *
  INTO saved
  FROM public.inventory_movements
  WHERE request_id = p_request_id;

  IF FOUND THEN
    IF saved.actor_id IS DISTINCT FROM actor
      OR saved.request_data IS DISTINCT FROM request
    THEN
      RAISE EXCEPTION 'INVENTORY_REQUEST_CONFLICT'
        USING errcode = '22023';
    END IF;

    RETURN jsonb_build_object(
      'product', saved.after_data,
      'movement', to_jsonb(saved)
    );
  END IF;

  -- Conserva el usuario autenticado en el historial.
  SELECT coalesce(email, actor::text)
  INTO actor_name
  FROM auth.users
  WHERE id = actor;

  IF p_action <> 'add' THEN
    SELECT *
    INTO before_product
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVENTORY_NOT_FOUND'
        USING errcode = 'P0002';
    END IF;

    IF p_action IN ('edit', 'catalog_edit', 'delete')
      AND before_product.version
        IS DISTINCT FROM p_expected_version
    THEN
      RAISE EXCEPTION 'INVENTORY_STALE_VERSION'
        USING errcode = '40001';
    END IF;
  END IF;

  IF p_action IN ('add', 'edit', 'catalog_edit') THEN
    IF nullif(btrim(p_data->>'name'), '') IS NULL
      OR nullif(btrim(p_data->>'sku'), '') IS NULL
      OR length(p_data->>'name') > 500
      OR length(p_data->>'sku') > 100
      OR (p_action <> 'catalog_edit' AND coalesce(jsonb_typeof(p_data->'stock'), '') <> 'number')
      OR coalesce(jsonb_typeof(p_data->'min_stock'), '') <> 'number'
      OR coalesce(jsonb_typeof(p_data->'price'), '') <> 'number'
    THEN
      RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'
        USING errcode = '22023';
    END IF;

    -- Fase 2: validar SOLO las claves presentes; omisión conserva datos.
    FOREACH attribute_name IN ARRAY ARRAY['brand', 'model', 'characteristics', 'barcode', 'unit_of_measure']
    LOOP
      IF p_data ? attribute_name THEN
        attribute_limit := CASE attribute_name
          WHEN 'brand' THEN 120 WHEN 'model' THEN 160
          WHEN 'characteristics' THEN 4000 WHEN 'barcode' THEN 100 ELSE 40 END;
        IF jsonb_typeof(p_data->attribute_name) NOT IN ('string', 'null')
          OR length(btrim(p_data->>attribute_name)) > attribute_limit
          OR (attribute_name = 'unit_of_measure' AND nullif(btrim(p_data->>attribute_name), '') IS NULL)
        THEN
          RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode = '22023';
        END IF;
      END IF;
    END LOOP;

    IF p_data ? 'purchase_cost' AND p_data->'purchase_cost' <> 'null'::jsonb THEN
      IF jsonb_typeof(p_data->'purchase_cost') <> 'number' THEN
        RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode = '22023';
      END IF;
      IF (p_data->>'purchase_cost')::numeric < 0
        OR (p_data->>'purchase_cost')::numeric >= 10000000000
        OR round((p_data->>'purchase_cost')::numeric, 2) <> (p_data->>'purchase_cost')::numeric
      THEN
        RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode = '22023';
      END IF;
    END IF;
    IF p_data ? 'is_active' AND jsonb_typeof(p_data->'is_active') <> 'boolean' THEN
      RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode = '22023';
    END IF;
    -- Fotografías pendientes: no aceptar rutas arbitrarias hasta revisar Storage.
    IF p_data ? 'image_path' THEN
      RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode = '22023';
    END IF;
    -- Separación efectiva en servidor: catalog_edit no acepta cantidades ni banderas.
    IF p_action = 'catalog_edit' AND (p_data ?| ARRAY['stock', 'delta', 'catalog_only']) THEN
      RAISE EXCEPTION 'INVENTORY_INVALID_INPUT' USING errcode = '22023';
    END IF;

    -- Nombre escrito en "Registrado por".
    IF p_data ? 'created_by_name' THEN
      IF coalesce(
          jsonb_typeof(p_data->'created_by_name'), ''
        ) <> 'string'
        OR nullif(
          btrim(p_data->>'created_by_name'), ''
        ) IS NULL
        OR length(
          btrim(p_data->>'created_by_name')
        ) > 120
      THEN
        RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'
          USING errcode = '22023';
      END IF;

      registered_by := btrim(p_data->>'created_by_name');

    ELSIF p_action IN ('edit', 'catalog_edit') THEN
      -- Si un cliente anterior no envía el campo, conserva el nombre.
      registered_by := before_product.created_by_name;
    END IF;

    requested_stock := CASE WHEN p_action = 'catalog_edit' THEN before_product.stock ELSE (p_data->>'stock')::numeric END;
    requested_min := (p_data->>'min_stock')::numeric;
    requested_price := (p_data->>'price')::numeric;

    IF requested_stock < 0
      OR requested_stock > 2147483647
      OR trunc(requested_stock) <> requested_stock
      OR requested_min < 0
      OR requested_min > 2147483647
      OR trunc(requested_min) <> requested_min
      OR requested_price < 0
      OR requested_price >= 10000000000
      OR round(requested_price, 2) <> requested_price
    THEN
      RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'
        USING errcode = '22023';
    END IF;

    SELECT id
    INTO category
    FROM public.categories
    WHERE name = p_data->>'category';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVENTORY_INVALID_CATEGORY'
        USING errcode = '22023';
    END IF;

    IF p_action = 'add' THEN
      INSERT INTO public.products (
        sku,
        name,
        category_id,
        stock,
        price,
        min_stock,
        created_by_name,
        brand, model, characteristics, barcode, purchase_cost, unit_of_measure, is_active
      )
      VALUES (
        btrim(p_data->>'sku'),
        btrim(p_data->>'name'),
        category,
        requested_stock,
        requested_price,
        requested_min,
        registered_by,
        coalesce(btrim(p_data->>'brand'), ''),
        coalesce(btrim(p_data->>'model'), ''),
        coalesce(btrim(p_data->>'characteristics'), ''),
        nullif(btrim(p_data->>'barcode'), ''),
        (p_data->>'purchase_cost')::numeric,
        coalesce(btrim(p_data->>'unit_of_measure'), 'Unidad'),
        coalesce((p_data->>'is_active')::boolean, true)
      )
      RETURNING * INTO after_product;

      movement_type := 'Alta';
      movement_reason := 'Registro de producto';

    ELSE
      UPDATE public.products
      SET
        sku = btrim(p_data->>'sku'),
        name = btrim(p_data->>'name'),
        category_id = category,
        stock = requested_stock,
        price = requested_price,
        min_stock = requested_min,
        created_by_name = registered_by,
        brand = CASE WHEN p_data ? 'brand' THEN coalesce(btrim(p_data->>'brand'), '') ELSE before_product.brand END,
        model = CASE WHEN p_data ? 'model' THEN coalesce(btrim(p_data->>'model'), '') ELSE before_product.model END,
        characteristics = CASE WHEN p_data ? 'characteristics' THEN coalesce(btrim(p_data->>'characteristics'), '') ELSE before_product.characteristics END,
        barcode = CASE WHEN p_data ? 'barcode' THEN nullif(btrim(p_data->>'barcode'), '') ELSE before_product.barcode END,
        purchase_cost = CASE WHEN p_data ? 'purchase_cost' THEN (p_data->>'purchase_cost')::numeric ELSE before_product.purchase_cost END,
        unit_of_measure = CASE WHEN p_data ? 'unit_of_measure' THEN btrim(p_data->>'unit_of_measure') ELSE before_product.unit_of_measure END,
        is_active = CASE WHEN p_data ? 'is_active' THEN (p_data->>'is_active')::boolean ELSE before_product.is_active END,
        -- image_path y source_status deliberadamente no se asignan.
        updated_at = transaction_timestamp(),
        version = version + 1
      WHERE id = p_product_id
      RETURNING * INTO after_product;

      movement_type := 'Ajuste';
      movement_reason := CASE WHEN p_action = 'catalog_edit' THEN 'Edición descriptiva de producto' ELSE 'Edición de producto' END;
    END IF;

  ELSIF p_action = 'delete' THEN
    DELETE FROM public.products
    WHERE id = p_product_id;

    movement_type := 'Baja';
    movement_reason := 'Eliminación de producto';

  ELSE
    IF p_data->>'delta' NOT IN ('-1', '1')
      OR p_data->>'delta' IS NULL
    THEN
      RAISE EXCEPTION 'INVENTORY_INVALID_INPUT'
        USING errcode = '22023';
    END IF;

    delta := (p_data->>'delta')::integer;

    IF before_product.stock + delta < 0 THEN
      RAISE EXCEPTION 'INVENTORY_NEGATIVE_STOCK'
        USING errcode = '22023';
    END IF;

    UPDATE public.products
    SET
      stock = stock + delta,
      updated_at = transaction_timestamp(),
      version = version + 1
    WHERE id = p_product_id
    RETURNING * INTO after_product;

    movement_type := CASE
      WHEN delta > 0 THEN 'Entrada'
      ELSE 'Salida'
    END;

    movement_reason := 'Cambio manual de existencias';
  END IF;

  INSERT INTO public.inventory_movements (
    request_id,
    request_data,
    product_id,
    product_name,
    sku,
    type,
    stock_before,
    stock_after,
    actor_id,
    actor_email,
    reason,
    before_data,
    after_data
  )
  VALUES (
    p_request_id,
    request,
    coalesce(after_product.id, before_product.id),
    coalesce(after_product.name, before_product.name),
    coalesce(after_product.sku, before_product.sku),
    movement_type,
    coalesce(before_product.stock, 0),
    coalesce(after_product.stock, 0),
    actor,
    actor_name,
    movement_reason,
    CASE
      WHEN p_action = 'add' THEN NULL
      ELSE to_jsonb(before_product)
    END,
    CASE
      WHEN p_action = 'delete' THEN NULL
      ELSE to_jsonb(after_product)
    END
  )
  RETURNING * INTO saved;

  RETURN jsonb_build_object(
    'product', saved.after_data,
    'movement', to_jsonb(saved)
  );
END;
$function$;

-- POSTVERIFICACION (antes de activar UI/API):
-- * Comparar valores previos de productos y filas históricas de ventas/movimientos.
-- * Verificar ACL y RLS sin diferencias, y rechazo de usuarios anon/no miembros.
-- * catalog_edit: omite stock; usa fila bloqueada, exige versión y rechaza stock/delta.
-- * Alta/recarga/costo/NOT NULL/SKU único; ventas conservan todos los atributos,
--   precio histórico, imagen/source_status y versión +1; reintentos no duplican.
--
-- LIMITE EXPLICITO: edit y adjust siguen siendo operaciones autorizadas de stock,
-- y la RPC de ventas sigue usando edit. Un miembro puede invocarlas directamente.
-- catalog_edit protege las ediciones descriptivas, no revoca permisos de inventario
-- ni impide que un miembro elija otra operación autorizada. No se afirma lo contrario.
-- edit/catalog_edit mantienen un movimiento Ajuste (cantidad cero si stock no cambia).
-- adjust conserva el contrato real -1/+1. Ampliarlo pertenece a otra fase.
-- Imagen opcional: se conserva image_path, pero no se aceptan rutas desde p_data.
-- Cargas deshabilitadas hasta configurar Storage seguro; no bloquean otros campos.
--
-- RECUPERACION:
-- Si algo falla antes de COMMIT: ROLLBACK de esta transacción.
-- Después de COMMIT: desactivar UI/API ampliada, conservar columnas/datos nuevos.
-- Restaurar RPC anterior desde respaldo verificado solo con autorización y revisar
-- operaciones pendientes/reintentos. No hacer DROP, borrar historial ni recalcular stock.
-- Un respaldo solo se considera verificado después de ensayar su restauración.
NOTIFY pgrst, 'reload schema';
COMMIT;

