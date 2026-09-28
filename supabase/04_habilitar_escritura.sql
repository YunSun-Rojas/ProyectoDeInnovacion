-- Ejecutar completo UNA VEZ después de los pasos 01, 02 y 03.
-- No modifica el stock ni el precio de los productos existentes.
begin;

alter table public.products add column version bigint not null default 1;

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  request_data jsonb not null,
  product_id bigint not null,
  product_name text not null,
  sku text not null,
  type text not null check (type in ('Alta', 'Ajuste', 'Baja', 'Entrada', 'Salida')),
  stock_before integer not null check (stock_before >= 0),
  stock_after integer not null check (stock_after >= 0),
  quantity integer generated always as (stock_after - stock_before) stored,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  reason text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
-- Se conserva la referencia y la foto del producto incluso después de eliminarlo.
create index inventory_movements_product_id_idx on public.inventory_movements(product_id);
alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from public, anon, authenticated;
revoke all on sequence public.inventory_movements_id_seq from public, anon, authenticated;
grant select on public.inventory_movements to authenticated;
create policy movements_read_members on public.inventory_movements
  for select to authenticated using (exists (
    select 1 from public.inventory_members m where m.user_id = (select auth.uid())
  ));

create function public.inventory_write_enabled() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.inventory_members where user_id = (select auth.uid()));
$$;
revoke all on function public.inventory_write_enabled() from public, anon;
grant execute on function public.inventory_write_enabled() to authenticated;

create function public.inventory_mutate(
  p_request_id uuid, p_action text, p_product_id bigint,
  p_expected_version bigint, p_data jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  before_product public.products%rowtype;
  after_product public.products%rowtype;
  saved public.inventory_movements%rowtype;
  request jsonb := jsonb_build_object('action', p_action, 'product_id', p_product_id,
    'version', p_expected_version, 'data', p_data);
  movement_type text;
  movement_reason text;
  requested_stock numeric;
  requested_min numeric;
  requested_price numeric;
  category bigint;
  delta integer;
begin
  if actor is null or not exists (select 1 from public.inventory_members where user_id = actor) then
    raise exception 'INVENTORY_FORBIDDEN' using errcode = '42501';
  end if;
  if p_request_id is null or p_action is null or p_action not in ('add', 'edit', 'delete', 'adjust')
    or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'INVENTORY_INVALID_INPUT' using errcode = '22023';
  end if;
  -- Dos reintentos de la misma operación no pueden ejecutar dos movimientos.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into saved from public.inventory_movements where request_id = p_request_id;
  if found then
    if saved.actor_id is distinct from actor or saved.request_data is distinct from request then
      raise exception 'INVENTORY_REQUEST_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object('product', saved.after_data, 'movement', to_jsonb(saved));
  end if;

  select coalesce(email, actor::text) into actor_name from auth.users where id = actor;
  if p_action <> 'add' then
    select * into before_product from public.products where id = p_product_id for update;
    if not found then raise exception 'INVENTORY_NOT_FOUND' using errcode = 'P0002'; end if;
    if p_action in ('edit', 'delete') and before_product.version is distinct from p_expected_version then
      raise exception 'INVENTORY_STALE_VERSION' using errcode = '40001';
    end if;
  end if;

  if p_action in ('add', 'edit') then
    if nullif(btrim(p_data->>'name'), '') is null or nullif(btrim(p_data->>'sku'), '') is null
      or length(p_data->>'name') > 500 or length(p_data->>'sku') > 100
      or coalesce(jsonb_typeof(p_data->'stock'), '') <> 'number'
      or coalesce(jsonb_typeof(p_data->'min_stock'), '') <> 'number'
      or coalesce(jsonb_typeof(p_data->'price'), '') <> 'number' then
      raise exception 'INVENTORY_INVALID_INPUT' using errcode = '22023';
    end if;
    requested_stock := (p_data->>'stock')::numeric;
    requested_min := (p_data->>'min_stock')::numeric;
    requested_price := (p_data->>'price')::numeric;
    if requested_stock < 0 or requested_stock > 2147483647 or trunc(requested_stock) <> requested_stock
      or requested_min < 0 or requested_min > 2147483647 or trunc(requested_min) <> requested_min
      or requested_price < 0 or requested_price >= 10000000000 or round(requested_price, 2) <> requested_price then
      raise exception 'INVENTORY_INVALID_INPUT' using errcode = '22023';
    end if;
    select id into category from public.categories where name = p_data->>'category';
    if not found then raise exception 'INVENTORY_INVALID_CATEGORY' using errcode = '22023'; end if;
    if p_action = 'add' then
      insert into public.products (sku, name, category_id, stock, price, min_stock)
      values (btrim(p_data->>'sku'), btrim(p_data->>'name'), category, requested_stock, requested_price, requested_min)
      returning * into after_product;
      movement_type := 'Alta'; movement_reason := 'Registro de producto';
    else
      update public.products set sku = btrim(p_data->>'sku'), name = btrim(p_data->>'name'),
        category_id = category, stock = requested_stock, price = requested_price,
        min_stock = requested_min, version = version + 1
      where id = p_product_id returning * into after_product;
      movement_type := 'Ajuste'; movement_reason := 'Edición de producto';
    end if;
  elsif p_action = 'delete' then
    delete from public.products where id = p_product_id;
    movement_type := 'Baja'; movement_reason := 'Eliminación de producto';
  else
    if p_data->>'delta' not in ('-1', '1') or p_data->>'delta' is null then
      raise exception 'INVENTORY_INVALID_INPUT' using errcode = '22023';
    end if;
    delta := (p_data->>'delta')::integer;
    if before_product.stock + delta < 0 then
      raise exception 'INVENTORY_NEGATIVE_STOCK' using errcode = '22023';
    end if;
    update public.products set stock = stock + delta, version = version + 1
    where id = p_product_id returning * into after_product;
    movement_type := case when delta > 0 then 'Entrada' else 'Salida' end;
    movement_reason := 'Cambio manual de existencias';
  end if;

  insert into public.inventory_movements
    (request_id, request_data, product_id, product_name, sku, type, stock_before, stock_after,
     actor_id, actor_email, reason, before_data, after_data)
  values (p_request_id, request, coalesce(after_product.id, before_product.id),
    coalesce(after_product.name, before_product.name), coalesce(after_product.sku, before_product.sku),
    movement_type, coalesce(before_product.stock, 0), coalesce(after_product.stock, 0),
    actor, actor_name, movement_reason,
    case when p_action = 'add' then null else to_jsonb(before_product) end,
    case when p_action = 'delete' then null else to_jsonb(after_product) end)
  returning * into saved;
  return jsonb_build_object('product', saved.after_data, 'movement', to_jsonb(saved));
end;
$$;
revoke all on function public.inventory_mutate(uuid, text, bigint, bigint, jsonb) from public, anon;
grant execute on function public.inventory_mutate(uuid, text, bigint, bigint, jsonb) to authenticated;
-- Las escrituras directas siguen cerradas: cada cambio pasa por la función
-- que comprueba la cuenta, bloquea la fila y registra el historial en la misma transacción.
commit;

select 'Fase 4 preparada' as resultado,
  (select count(*) from public.products) as productos,
  (select count(*) from public.inventory_movements) as movimientos;
