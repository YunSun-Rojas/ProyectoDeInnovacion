-- Eagle Gaming: compras y ventas multiartículo, aditivo y transaccional.
-- Aplicar después de Fases 2, 3 y SQL de ventas; no borra ni reescribe historial.
begin;
set local lock_timeout = '5s';

do $preflight$
begin
  if to_regprocedure('public.inventory_register_stock(uuid,bigint,bigint,text,integer,text)') is null
    or to_regprocedure('public.inventory_register_sale(uuid,bigint,bigint,integer,numeric)') is null
    or to_regclass('public.inventory_sales') is null
    or to_regclass('public.inventory_members') is null
    or has_schema_privilege('authenticated','public','CREATE')
    or has_schema_privilege('anon','public','CREATE') then
    raise exception 'COMMERCE_SCHEMA_DRIFT: aplicar antes las fases de stock y ventas y revisar permisos de public';
  end if;
end
$preflight$;

create table public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 180),
  tax_id text,
  phone text,
  email text,
  active boolean not null default true,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);
create table public.inventory_purchases (
  id uuid primary key,
  code text not null unique,
  supplier_id uuid references public.inventory_suppliers(id) on delete restrict,
  supplier_name text not null,
  purchase_date date not null,
  reference text not null default '',
  notes text not null default '',
  status text not null check (status in ('pendiente','recibida','cancelada')),
  total numeric(14,2) not null check (total >= 0),
  actor_id uuid not null,
  actor_email text not null,
  received_at timestamptz,
  cancelled_at timestamptz,
  request_data jsonb not null,
  rpc_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.inventory_purchase_lines (
  id uuid primary key,
  purchase_id uuid not null references public.inventory_purchases(id) on delete restrict,
  product_id bigint not null,
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity between 1 and 2147483647),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  subtotal numeric(14,2) generated always as (quantity * unit_cost) stored,
  reversal_request_id uuid not null unique,
  unique (purchase_id, product_id),
  check (quantity::numeric * unit_cost <= 999999999999.99)
);
create table public.inventory_sale_orders (
  id uuid primary key,
  code text not null unique,
  customer text not null default '',
  sale_date date not null,
  reference text not null default '',
  notes text not null default '',
  status text not null check (status in ('pendiente','confirmada','cancelada')),
  total numeric(14,2) not null check (total >= 0),
  actor_id uuid not null,
  actor_email text not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  request_data jsonb not null,
  rpc_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.inventory_sale_lines (
  id uuid primary key,
  sale_id uuid not null references public.inventory_sale_orders(id) on delete restrict,
  product_id bigint not null,
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity between 1 and 2147483647),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) generated always as (quantity * unit_price) stored,
  inventory_sale_id uuid not null unique,
  reversal_request_id uuid not null unique,
  unique (sale_id, product_id),
  check (quantity::numeric * unit_price <= 999999999999.99)
);
create index inventory_purchases_created_idx on public.inventory_purchases(purchase_date desc, created_at desc);
create index inventory_sale_orders_created_idx on public.inventory_sale_orders(sale_date desc, created_at desc);
create index inventory_purchase_lines_parent_idx on public.inventory_purchase_lines(purchase_id);
create index inventory_sale_lines_parent_idx on public.inventory_sale_lines(sale_id);
alter table public.inventory_sales add column sale_order_id uuid references public.inventory_sale_orders(id) on delete restrict;
alter table public.inventory_sales add column cancelled_at timestamptz;
create index inventory_sales_order_idx on public.inventory_sales(sale_order_id) where sale_order_id is not null;

do $rls$
declare t text;
begin
  foreach t in array array['inventory_suppliers','inventory_purchases','inventory_purchase_lines','inventory_sale_orders','inventory_sale_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.inventory_members m where m.user_id=auth.uid()))', t||'_members_read', t);
  end loop;
end
$rls$;
revoke update(sale_order_id) on public.inventory_sales from public, anon, authenticated;
grant select(sale_order_id) on public.inventory_sales to authenticated;
grant select(cancelled_at) on public.inventory_sales to authenticated;

create function public.inventory_commerce_enabled() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.inventory_members where user_id=auth.uid());
$$;

create function public.inventory_supplier_save(p_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare actor uuid := auth.uid(); saved public.inventory_suppliers%rowtype;
begin
  if actor is null or not exists(select 1 from public.inventory_members where user_id=actor)
    or public.inventory_write_enabled() is distinct from true then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501'; end if;
  if p_id is null or jsonb_typeof(p_data) <> 'object' or length(btrim(coalesce(p_data->>'name',''))) not between 1 and 180
    or length(coalesce(p_data->>'taxId','')) > 40 or length(coalesce(p_data->>'phone','')) > 60
    or length(coalesce(p_data->>'email','')) > 180 then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
  insert into public.inventory_suppliers(id,name,tax_id,phone,email,actor_id)
    values(p_id,btrim(p_data->>'name'),nullif(btrim(p_data->>'taxId'),''),nullif(btrim(p_data->>'phone'),''),nullif(btrim(p_data->>'email'),''),actor)
    on conflict(id) do update set name=excluded.name,tax_id=excluded.tax_id,phone=excluded.phone,email=excluded.email,updated_at=now()
    where inventory_suppliers.actor_id=actor
    returning * into saved;
  if saved.id is null then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501'; end if;
  return to_jsonb(saved);
end
$function$;

create function public.inventory_purchase(p_action text, p_id uuid, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare actor uuid := auth.uid(); actor_email text; header public.inventory_purchases%rowtype; row_line record; product public.products%rowtype; result jsonb := '[]'::jsonb; saved jsonb; v_total numeric;
begin
  if actor is null or not exists(select 1 from public.inventory_members where user_id=actor)
    or public.inventory_write_enabled() is distinct from true then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501'; end if;
  if p_id is null then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  if p_action='create' then
    if jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'lines')<>'array' or jsonb_array_length(p_data->'lines') not between 1 and 100 then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    select email into actor_email from auth.users where id=actor;
    if exists(select 1 from jsonb_to_recordset(p_data->'lines') x(product_id bigint, quantity integer, unit_cost numeric, id uuid, reversal_id uuid)
      where product_id is null or quantity is null or quantity<=0 or unit_cost is null or unit_cost<0 or unit_cost<>round(unit_cost,2) or id is null or reversal_id is null)
      or (select count(*) from jsonb_to_recordset(p_data->'lines') x(product_id bigint)) <> (select count(distinct product_id) from jsonb_to_recordset(p_data->'lines') x(product_id bigint)) then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(p_data->'lines') x(quantity integer,unit_cost numeric) where quantity::numeric*unit_cost>999999999999.99) then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(p_data->'lines') x(id uuid,reversal_id uuid) where id=reversal_id) then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(p_data->'lines') x(product_id bigint) left join public.products p on p.id=x.product_id where p.id is null) then raise exception 'INVENTORY_NOT_FOUND'; end if;
    if p_data->>'supplierId' is not null and not exists(select 1 from public.inventory_suppliers where id=(p_data->>'supplierId')::uuid and active) then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    select coalesce(sum(x.quantity::numeric*x.unit_cost),0) into v_total from jsonb_to_recordset(p_data->'lines') x(quantity integer,unit_cost numeric);
    if v_total>999999999999.99 then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    if exists(select 1 from public.inventory_purchases where id=p_id) then
      select * into header from public.inventory_purchases where id=p_id;
      if header.actor_id<>actor or header.request_data<>p_data then raise exception 'INVENTORY_REQUEST_CONFLICT' using errcode='22023'; end if;
      return jsonb_build_object('operation',to_jsonb(header));
    end if;
    insert into public.inventory_purchases(id,code,supplier_id,supplier_name,purchase_date,reference,notes,status,total,actor_id,actor_email,request_data)
      select p_id,'CMP-'||to_char(current_date,'YYYYMMDD')||'-'||upper(right(replace(p_id::text,'-',''),12)),s.id,coalesce(s.name,btrim(coalesce(p_data->>'supplierName','Proveedor sin registrar'))),
        coalesce((p_data->>'date')::date,current_date),left(coalesce(p_data->>'reference',''),120),left(coalesce(p_data->>'notes',''),1000),'pendiente',v_total,actor,coalesce(actor_email,''),p_data
      from (select 1) q left join public.inventory_suppliers s on s.id=nullif(p_data->>'supplierId','')::uuid returning * into header;
    for row_line in select * from jsonb_to_recordset(p_data->'lines') x(product_id bigint,quantity integer,unit_cost numeric,id uuid,reversal_id uuid) order by product_id loop
      select * into product from public.products where id=row_line.product_id;
      insert into public.inventory_purchase_lines(id,purchase_id,product_id,product_name,sku,quantity,unit_cost,reversal_request_id)
        values(row_line.id,p_id,product.id,product.name,product.sku,row_line.quantity,row_line.unit_cost,row_line.reversal_id);
    end loop;
    return jsonb_build_object('operation',to_jsonb(header));
  end if;
  select * into header from public.inventory_purchases where id=p_id for update;
  if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
  if header.status='cancelada' and p_action='cancel' then return jsonb_build_object('operation',to_jsonb(header)); end if;
  if header.status='recibida' and p_action='receive' then return header.rpc_result; end if;
  if header.status<>'pendiente' then raise exception 'INVENTORY_IMMUTABLE'; end if;
  if p_action='cancel' then
    update public.inventory_purchases set status='cancelada',cancelled_at=now() where id=p_id returning * into header;
    return jsonb_build_object('operation',to_jsonb(header));
  elsif p_action<>'receive' then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
  if public.inventory_stock_enabled() is distinct from true then raise exception 'INVENTORY_STOCK_DISABLED'; end if;
  for row_line in select * from public.inventory_purchase_lines where purchase_id=p_id order by product_id loop
    select * into product from public.products where id=row_line.product_id for update;
    if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
    saved := public.inventory_register_stock(row_line.id,row_line.product_id,product.version,'stock_in',row_line.quantity,'Recepción '||header.code||case when header.reference='' then '' else ' · '||header.reference end);
    result := result || jsonb_build_array(jsonb_build_object('product',saved->'product','movement',saved->'movement'));
  end loop;
  update public.inventory_purchases set status='recibida',received_at=now(),rpc_result=jsonb_build_object('operation',to_jsonb(header)||jsonb_build_object('status','recibida','received_at',now()),'results',result)
    where id=p_id returning * into header;
  return header.rpc_result;
exception when unique_violation then raise exception 'INVENTORY_REQUEST_CONFLICT' using errcode='22023';
end
$function$;

create function public.inventory_sale_order(p_action text, p_id uuid, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare actor uuid := auth.uid(); actor_email text; header public.inventory_sale_orders%rowtype; row_line record; product public.products%rowtype; result jsonb := '[]'::jsonb; saved jsonb; v_total numeric;
begin
  if actor is null or not exists(select 1 from public.inventory_members where user_id=actor)
    or public.inventory_write_enabled() is distinct from true then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501'; end if;
  if p_id is null then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  if p_action='create' then
    if jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'lines')<>'array' or jsonb_array_length(p_data->'lines') not between 1 and 100 then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    select email into actor_email from auth.users where id=actor;
    if exists(select 1 from jsonb_to_recordset(p_data->'lines') x(product_id bigint,quantity integer,unit_price numeric,id uuid,reversal_id uuid)
      where product_id is null or quantity is null or quantity<=0 or unit_price is null or unit_price<0 or unit_price<>round(unit_price,2) or id is null or reversal_id is null)
      or (select count(*) from jsonb_to_recordset(p_data->'lines') x(product_id bigint)) <> (select count(distinct product_id) from jsonb_to_recordset(p_data->'lines') x(product_id bigint)) then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(p_data->'lines') x(quantity integer,unit_price numeric) where quantity::numeric*unit_price>999999999999.99) then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(p_data->'lines') x(id uuid,reversal_id uuid) where id=reversal_id) then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(p_data->'lines') x(product_id bigint) left join public.products p on p.id=x.product_id where p.id is null) then raise exception 'INVENTORY_NOT_FOUND'; end if;
    select coalesce(sum(x.quantity::numeric*x.unit_price),0) into v_total from jsonb_to_recordset(p_data->'lines') x(quantity integer,unit_price numeric);
    if v_total>999999999999.99 then raise exception 'INVENTORY_INVALID_INPUT' using errcode='22023'; end if;
    if exists(select 1 from public.inventory_sale_orders where id=p_id) then
      select * into header from public.inventory_sale_orders where id=p_id;
      if header.actor_id<>actor or header.request_data<>p_data then raise exception 'INVENTORY_REQUEST_CONFLICT' using errcode='22023'; end if;
      return jsonb_build_object('operation',to_jsonb(header));
    end if;
    insert into public.inventory_sale_orders(id,code,customer,sale_date,reference,notes,status,total,actor_id,actor_email,request_data)
      values(p_id,'VTA-'||to_char(current_date,'YYYYMMDD')||'-'||upper(right(replace(p_id::text,'-',''),12)),left(coalesce(p_data->>'customer',''),180),coalesce((p_data->>'date')::date,current_date),left(coalesce(p_data->>'reference',''),120),left(coalesce(p_data->>'notes',''),1000),'pendiente',v_total,actor,coalesce(actor_email,''),p_data)
      returning * into header;
    for row_line in select * from jsonb_to_recordset(p_data->'lines') x(product_id bigint,quantity integer,unit_price numeric,id uuid,reversal_id uuid) order by product_id loop
      select * into product from public.products where id=row_line.product_id;
      insert into public.inventory_sale_lines(id,sale_id,product_id,product_name,sku,quantity,unit_price,inventory_sale_id,reversal_request_id)
        values(row_line.id,p_id,product.id,product.name,product.sku,row_line.quantity,row_line.unit_price,row_line.id,row_line.reversal_id);
    end loop;
    return jsonb_build_object('operation',to_jsonb(header));
  end if;
  select * into header from public.inventory_sale_orders where id=p_id for update;
  if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
  if header.status='cancelada' and p_action='cancel' then return jsonb_build_object('operation',to_jsonb(header)); end if;
  if header.status='confirmada' and p_action='confirm' then return header.rpc_result; end if;
  if header.status='pendiente' and p_action='cancel' then
    update public.inventory_sale_orders set status='cancelada',cancelled_at=now() where id=p_id returning * into header;
    return jsonb_build_object('operation',to_jsonb(header));
  end if;
  if header.status='pendiente' and p_action='confirm' then
    if public.inventory_sales_enabled() is distinct from true then raise exception 'INVENTORY_SALES_DISABLED'; end if;
    for row_line in select * from public.inventory_sale_lines where sale_id=p_id order by product_id loop
      select * into product from public.products where id=row_line.product_id for update;
      if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
      if row_line.quantity>product.stock then raise exception 'INVENTORY_NEGATIVE_STOCK'; end if;
      saved := public.inventory_register_sale(row_line.inventory_sale_id,row_line.product_id,product.version,row_line.quantity,row_line.unit_price);
      update public.inventory_sales set sale_order_id=p_id where id=row_line.inventory_sale_id;
      result := result || jsonb_build_array(jsonb_build_object('product',saved->'product','movement',saved->'movement','sale',saved->'sale'));
    end loop;
    update public.inventory_sale_orders set status='confirmada',confirmed_at=now(),rpc_result=jsonb_build_object('operation',to_jsonb(header)||jsonb_build_object('status','confirmada','confirmed_at',now()),'results',result)
      where id=p_id returning * into header;
    return header.rpc_result;
  end if;
  if header.status='confirmada' and p_action='cancel' then
    if public.inventory_stock_enabled() is distinct from true then raise exception 'INVENTORY_STOCK_DISABLED'; end if;
    for row_line in select * from public.inventory_sale_lines where sale_id=p_id order by product_id loop
      select * into product from public.products where id=row_line.product_id for update;
      if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
      saved := public.inventory_register_stock(row_line.reversal_request_id,row_line.product_id,product.version,'stock_in',row_line.quantity,'Reversión venta '||header.code||case when header.reference='' then '' else ' · '||header.reference end);
      update public.inventory_sales set cancelled_at=now() where id=row_line.inventory_sale_id;
      if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
      result := result || jsonb_build_array(jsonb_build_object('product',saved->'product','movement',saved->'movement'));
    end loop;
    update public.inventory_sale_orders set status='cancelada',cancelled_at=now(),rpc_result=jsonb_build_object('operation',to_jsonb(header)||jsonb_build_object('status','cancelada','cancelled_at',now()),'results',result)
      where id=p_id returning * into header;
    return header.rpc_result;
  end if;
  raise exception 'INVENTORY_IMMUTABLE';
exception when unique_violation then raise exception 'INVENTORY_REQUEST_CONFLICT' using errcode='22023';
end
$function$;

revoke all on function public.inventory_commerce_enabled() from public,anon;
revoke all on function public.inventory_supplier_save(uuid,jsonb) from public,anon;
revoke all on function public.inventory_purchase(text,uuid,jsonb) from public,anon;
revoke all on function public.inventory_sale_order(text,uuid,jsonb) from public,anon;
grant execute on function public.inventory_commerce_enabled() to authenticated;
grant execute on function public.inventory_supplier_save(uuid,jsonb) to authenticated;
grant execute on function public.inventory_purchase(text,uuid,jsonb) to authenticated;
grant execute on function public.inventory_sale_order(text,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
