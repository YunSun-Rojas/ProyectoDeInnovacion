// Prueba aislada: no conecta con Supabase ni utiliza sus credenciales.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const modulePath = process.env.PGLITE_MODULE || join(tmpdir(), 'codex-inventory-sql-test/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const member = '00000000-0000-4000-8000-000000000001';
const outsider = '00000000-0000-4000-8000-000000000002';
const scalar = async sql => (await db.query(sql)).rows[0].value;
const mutate = (action, id, version, data, requestId = randomUUID()) => db.query(
  'select public.inventory_mutate($1::uuid, $2::text, $3::bigint, $4::bigint, $5::jsonb) as value',
  [requestId, action, id, version, JSON.stringify(data)],
).then(result => result.rows[0].value);

try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    insert into auth.users values ('${member}', 'member@example.test'), ('${outsider}', 'outsider@example.test');`);
  for (const file of ['01_crear_tablas.sql', '02_importar_productos.sql', '04_habilitar_escritura.sql']) {
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  assert.equal(Number(await scalar('select count(*) as value from public.products')), 173);
  assert.equal(Number(await scalar('select count(*) as value from public.inventory_movements')), 0);
  await db.exec(`insert into public.inventory_members(user_id) values ('${member}'); set role anon;`);
  await assert.rejects(mutate('add', null, null, {}), /permission denied/);
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${outsider}', false);`);
  assert.equal(await scalar('select public.inventory_write_enabled() as value'), false);
  assert.equal(Number(await scalar('select count(*) as value from public.products')), 0);
  await assert.rejects(mutate('add', null, null, {}), /INVENTORY_FORBIDDEN/);
  await db.exec(`select set_config('request.jwt.claim.sub', '${member}', false);`);
  assert.equal(await scalar('select public.inventory_write_enabled() as value'), true);
  await assert.rejects(db.exec('delete from public.products where id=1'), /permission denied/);
  await assert.rejects(db.exec('delete from public.inventory_movements'), /permission denied/);
  await assert.rejects(db.exec(`insert into public.inventory_members(user_id) values ('${outsider}')`), /permission denied/);

  const data = { name: 'Producto de prueba', sku: 'TEST-FASE4', category: 'Altavoces', stock: 2, min_stock: 1, price: 10.50 };
  const addId = randomUUID();
  const added = await mutate('add', null, null, data, addId);
  assert.equal(added.product.id, 174);
  assert.equal(added.movement.type, 'Alta');
  assert.equal(added.movement.actor_email, 'member@example.test');
  assert.deepEqual(await mutate('add', null, null, data, addId), added);
  assert.equal(Number(await scalar('select count(*) as value from public.inventory_movements')), 1);
  await assert.rejects(mutate('add', null, null, { ...data, name: 'Otro' }, addId), /INVENTORY_REQUEST_CONFLICT/);
  await assert.rejects(mutate('add', null, null, data), /unique constraint/);
  await assert.rejects(mutate('add', null, null, { ...data, sku: 'NEG', stock: -1 }), /INVENTORY_INVALID_INPUT/);
  await assert.rejects(mutate('add', null, null, { ...data, sku: 'DEC', stock: 1.5 }), /INVENTORY_INVALID_INPUT/);
  await assert.rejects(mutate('add', null, null, { ...data, sku: 'CAT', category: 'Inexistente' }), /INVENTORY_INVALID_CATEGORY/);

  const adjustmentId = randomUUID();
  const increased = await mutate('adjust', 174, 1, { delta: 1 }, adjustmentId);
  assert.equal(increased.product.stock, 3);
  assert.deepEqual(await mutate('adjust', 174, 1, { delta: 1 }, adjustmentId), increased);
  // Dos solicitudes independientes con la misma versión inicial suman ambas.
  const increasedAgain = await mutate('adjust', 174, 1, { delta: 1 });
  assert.equal(increasedAgain.product.stock, 4);
  await assert.rejects(mutate('edit', 174, 1, data), /INVENTORY_STALE_VERSION/);
  await assert.rejects(mutate('delete', 174, 1, {}), /INVENTORY_STALE_VERSION/);
  const edited = await mutate('edit', 174, increasedAgain.product.version, { ...data, price: 12.25, stock: 0 });
  assert.equal(edited.product.price, 12.25);
  assert.equal(edited.movement.before_data.price, 10.5);
  assert.equal(edited.movement.type, 'Ajuste');
  await assert.rejects(mutate('adjust', 174, edited.product.version, { delta: -1 }), /INVENTORY_NEGATIVE_STOCK/);
  assert.equal(Number(await scalar('select count(*) as value from public.inventory_movements')), 4);
  const deleteId = randomUUID();
  const deleted = await mutate('delete', 174, edited.product.version, {}, deleteId);
  assert.equal(deleted.product, null);
  assert.equal(deleted.movement.product_name, data.name);
  assert.equal(deleted.movement.type, 'Baja');
  assert.deepEqual(await mutate('delete', 174, edited.product.version, {}, deleteId), deleted);
  assert.equal(Number(await scalar('select count(*) as value from public.products')), 173);
  assert.equal(Number(await scalar('select sum(stock * price) as value from public.products')), 618895);
  assert.equal(Number(await scalar('select count(*) as value from public.inventory_movements')), 5);
  console.log('SQL verificado: creación, importación, RLS, permisos, altas, edición, eliminación, stock, versiones, reintentos e historial.');
} finally {
  await db.close();
}
