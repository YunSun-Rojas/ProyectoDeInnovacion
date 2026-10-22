-- Ampliación ADITIVA: conserva las tablas y la RPC inventory_mutate existentes.
-- Ejecutar una vez en el SQL Editor del proyecto Supabase, con rol propietario.
-- No convierte salidas antiguas en ventas ni inventa precios históricos.
begin;

-- La RPC existente puede resolver sus tablas en public. Verificar que los
-- clientes no pueden crear objetos allí antes de reutilizar ese search_path.
do $$ begin
  if has_schema_privilege('authenticated', 'public', 'CREATE')
    or has_schema_privilege('anon', 'public', 'CREATE') then
    raise exception 'Revisar permisos: public debe impedir CREATE a anon/authenticated antes de habilitar ventas.';
  end if;
end $$;

create table public.inventory_sales (
  id uuid primary key,
  product_id bigint not null,
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total numeric(22,2) generated always as (quantity * unit_price) stored,
  expected_version bigint not null,
  movement_id text not null unique,
  actor_id uuid not null,
  actor_email text not null,
  created_at timestamptz not null default now(),
  rpc_result jsonb not null,
  check (quantity::numeric * unit_price <= 90071992547409.91)
);

-- Sin FK al producto: borrar o renombrar un producto no borra sus ventas.
create index inventory_sales_created_at_idx on public.inventory_sales (created_at);
alter table public.inventory_sales enable row level security;
revoke all on public.inventory_sales from public, anon, authenticated;
grant select (id, product_id, product_name, sku, quantity, unit_price, total,
  expected_version, movement_id, actor_id, actor_email, created_at)
  on public.inventory_sales to authenticated;
create policy inventory_sales_read_members on public.inventory_sales for select to authenticated
  using (exists (select 1 from public.inventory_members m where m.user_id = auth.uid()));

create function public.inventory_sales_enabled() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.inventory_members where user_id = auth.uid());
$$;

create function public.inventory_register_sale(
  p_request_id uuid,
  p_product_id bigint,
  p_expected_version bigint,
  p_quantity integer,
  p_unit_price numeric
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_sale public.inventory_sales%rowtype;
  v_category text;
  v_result jsonb;
begin
  if v_user is null or not exists (select 1 from public.inventory_members where user_id = v_user)
    or public.inventory_write_enabled() is distinct from true then
    raise exception 'INVENTORY_FORBIDDEN';
  end if;
  if p_request_id is null or p_product_id is null or p_product_id <= 0
    or p_expected_version is null or p_expected_version <= 0
    or p_quantity is null or p_quantity <= 0 or p_unit_price is null
    or p_unit_price < 0 or p_unit_price >= 10000000000
    or p_unit_price::text in ('NaN', 'Infinity', '-Infinity')
    or p_unit_price <> round(p_unit_price, 2)
    or p_quantity::numeric * p_unit_price > 90071992547409.91 then
    raise exception 'INVENTORY_INVALID_INPUT';
  end if;

  -- Serializa reintentos del mismo ID, incluidos los de conexiones distintas.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_sale from public.inventory_sales where id = p_request_id;
  if found then
    if v_sale.actor_id <> v_user or v_sale.product_id <> p_product_id
      or v_sale.expected_version <> p_expected_version or v_sale.quantity <> p_quantity
      or v_sale.unit_price <> p_unit_price then
      raise exception 'INVENTORY_REQUEST_CONFLICT';
    end if;
    return v_sale.rpc_result || jsonb_build_object('sale', to_jsonb(v_sale) - 'rpc_result');
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
  if v_product.version <> p_expected_version then raise exception 'INVENTORY_STALE_VERSION'; end if;
  if p_quantity > v_product.stock then raise exception 'INVENTORY_NEGATIVE_STOCK'; end if;
  select name into v_category from public.categories where id = v_product.category_id;
  if v_category is null then raise exception 'INVENTORY_INVALID_CATEGORY'; end if;

  -- Reutiliza el contrato de edición existente. Precio y atributos no cambian.
  -- Stock, historial y venta se confirman en la MISMA transacción PostgreSQL.
  select public.inventory_mutate(
    p_request_id => p_request_id,
    p_action => 'edit',
    p_product_id => v_product.id,
    p_expected_version => v_product.version,
    p_data => jsonb_build_object('name', v_product.name, 'sku', v_product.sku,
      'category', v_category, 'stock', v_product.stock - p_quantity,
      'min_stock', v_product.min_stock, 'price', v_product.price)
  ) into v_result;

  -- Impide aceptar respuestas vacías o el replay de una operación de otro tipo.
  if v_result->'movement'->>'id' is null
    or (v_result->'product'->>'id')::bigint is distinct from p_product_id
    or (v_result->'product'->>'stock')::integer is distinct from v_product.stock - p_quantity
    or (v_result->'product'->>'version')::bigint is distinct from p_expected_version + 1 then
    raise exception 'INVENTORY_REQUEST_CONFLICT';
  end if;
  if not exists (select 1 from public.products where id = p_product_id
    and stock = v_product.stock - p_quantity and version = p_expected_version + 1) then
    raise exception 'INVENTORY_REQUEST_CONFLICT';
  end if;

  insert into public.inventory_sales (id, product_id, product_name, sku, quantity, unit_price,
    expected_version, movement_id, actor_id, actor_email, rpc_result)
  values (p_request_id, p_product_id, v_product.name, v_product.sku, p_quantity, p_unit_price,
    p_expected_version, v_result->'movement'->>'id', v_user, coalesce(auth.jwt()->>'email', ''), v_result)
  returning * into v_sale;
  return v_result || jsonb_build_object('sale', to_jsonb(v_sale) - 'rpc_result');
end;
$$;

revoke all on function public.inventory_sales_enabled() from public, anon;
revoke all on function public.inventory_register_sale(uuid, bigint, bigint, integer, numeric) from public, anon;
grant execute on function public.inventory_sales_enabled() to authenticated;
grant execute on function public.inventory_register_sale(uuid, bigint, bigint, integer, numeric) to authenticated;
notify pgrst, 'reload schema';
commit;
