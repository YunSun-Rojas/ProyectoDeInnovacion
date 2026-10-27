import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { preparePredictionView, evaluatePredictionView } from '../../frontend/src/modules/inventario/pages/predictionViewData.js';

// Entirely synthetic, in-memory PostgreSQL. Never loads .env or contacts Supabase.
const reviewer = '00000000-0000-4000-8000-000000000001';
const member = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const saleId = '10000000-0000-4000-8000-000000000001';
const fixture = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${reviewer}'),('${member}'),('${outsider}');
CREATE TABLE public.inventory_members(user_id uuid PRIMARY KEY);
INSERT INTO public.inventory_members VALUES ('${reviewer}'),('${member}');
CREATE TABLE public.products(id bigint PRIMARY KEY, stock integer);
INSERT INTO public.products VALUES (1,10),(2,20),(7,10);
CREATE TABLE public.inventory_sales(id uuid PRIMARY KEY,product_id bigint NOT NULL,created_at timestamptz NOT NULL,quantity integer);
INSERT INTO public.inventory_sales VALUES ('${saleId}',1,'2025-01-01T15:00:00Z',2);
CREATE TABLE public.inventory_movements(id integer PRIMARY KEY,quantity integer);
INSERT INTO public.inventory_movements VALUES (1,-2);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_members ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
`;
const migrationUrl = new URL('./sql/20261027_prediction_evidence.proposed.sql', import.meta.url);
const inspectorUrl = new URL('./sql/20261027_prediction_evidence.inspect.sql', import.meta.url);
const rollbackUrl = new URL('./sql/20261027_prediction_evidence.rollback.proposed.sql', import.meta.url);

test('foreign-key privileges can be confined to auth.users.id without whole-table REFERENCES', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fixture);
  // A restricted synthetic role demonstrates the actual FK permission rule.
  await db.exec(`CREATE ROLE prediction_fk_owner;
    GRANT USAGE ON SCHEMA auth,public TO prediction_fk_owner;
    GRANT CREATE ON SCHEMA public TO prediction_fk_owner;
    GRANT REFERENCES(id) ON auth.users TO prediction_fk_owner;
    SET ROLE prediction_fk_owner`);
  const flags = (await db.query("SELECT has_table_privilege(current_user,'auth.users','REFERENCES') AS table_access, has_column_privilege(current_user,'auth.users','id','REFERENCES') AS column_access")).rows[0];
  assert.equal(flags.table_access, false);
  assert.equal(flags.column_access, true);
  await db.exec('CREATE TABLE public.synthetic_fk_validation(id uuid REFERENCES auth.users(id))');
});

test('prediction migration preflight rejects incompatible schema and unsafe roles transactionally', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fixture);
  const migration = await readFile(migrationUrl, 'utf8');
  const cases = [
    ['wrong product ID type', 'ALTER TABLE products ALTER COLUMN id TYPE integer', /PREDICTION_COLUMN_DRIFT/],
    ['wrong sale product ID type', 'ALTER TABLE inventory_sales ALTER COLUMN product_id TYPE integer', /PREDICTION_COLUMN_DRIFT/],
    ['missing sale primary key', 'ALTER TABLE inventory_sales DROP CONSTRAINT inventory_sales_pkey', /PREDICTION_PRIMARY_KEY_DRIFT/],
    ['nullable sale timestamp', 'ALTER TABLE inventory_sales ALTER COLUMN created_at DROP NOT NULL', /PREDICTION_COLUMN_DRIFT/],
    ['missing RLS', 'ALTER TABLE inventory_members DISABLE ROW LEVEL SECURITY', /PREDICTION_RLS_REQUIRED/],
    ['client schema creation', 'GRANT CREATE ON SCHEMA public TO authenticated', /PREDICTION_UNSAFE_CLIENT_PRIVILEGES/],
    ['privileged client membership', 'GRANT postgres TO authenticated', /PREDICTION_UNSAFE_CLIENT_PRIVILEGES/],
    ['client can log in', 'ALTER ROLE authenticated LOGIN', /PREDICTION_UNSAFE_CLIENT_PRIVILEGES/],
    ['overload collision', 'CREATE FUNCTION public.inventory_prediction_evidence(integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$', /PREDICTION_OBJECTS_ALREADY_PRESENT/],
    ['wrong deployment role', 'SET LOCAL ROLE authenticated', /PREDICTION_OWNER_REQUIRED/],
    ['identity sequence name collision', `CREATE SEQUENCE public.inventory_prediction_sale_reviews_id_seq;
      GRANT USAGE ON SEQUENCE public.inventory_prediction_sale_reviews_id_seq TO authenticated`, /PREDICTION_OBJECTS_ALREADY_PRESENT/],
    ['inherited default table privileges', `CREATE ROLE prediction_acl_parent; GRANT prediction_acl_parent TO authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO prediction_acl_parent`, /PREDICTION_EFFECTIVE_ACL_DRIFT/],
    ['inherited default sequence privileges', `CREATE ROLE prediction_acl_parent; GRANT prediction_acl_parent TO authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE ON SEQUENCES TO prediction_acl_parent`, /PREDICTION_EFFECTIVE_ACL_DRIFT/],
    ['inherited default execution privileges', `CREATE ROLE prediction_acl_parent; GRANT prediction_acl_parent TO anon;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO prediction_acl_parent`, /PREDICTION_EFFECTIVE_ACL_DRIFT/],
  ];
  for (const [name, alter, pattern] of cases) {
    await t.test(name, async () => {
      // Outer transaction restores synthetic changes after the expected failure.
      await db.exec(`BEGIN; ${alter}`);
      try { await assert.rejects(db.exec(migration), pattern); }
      finally { await db.exec('ROLLBACK'); }
      assert.equal((await db.query("SELECT to_regclass('public.inventory_prediction_reviewers')::text AS name")).rows[0].name, null);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM inventory_sales')).rows[0].count, 1);
    });
  }
});

test('pending prediction migration: authorization, append-only audit, availability and sanitized evidence', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fixture);
  const originals = (await db.query(`SELECT jsonb_build_object('sales',(SELECT jsonb_agg(s) FROM inventory_sales s),
    'products',(SELECT jsonb_agg(p ORDER BY id) FROM products p),'movements',(SELECT jsonb_agg(m) FROM inventory_movements m)) AS data`)).rows[0].data;
  await db.exec(await readFile(migrationUrl, 'utf8'));
  await t.test('metadata inspector executes read-only before deployment and empty rollback preserves business tables', async () => {
    const inspector = await readFile(inspectorUrl, 'utf8');
    await db.exec('BEGIN READ ONLY');
    assert.ok((await db.exec(inspector)).length > 0);
    await db.exec('ROLLBACK');
    await db.exec(await readFile(rollbackUrl, 'utf8'));
    assert.equal((await db.query("SELECT to_regclass('public.inventory_prediction_reviewers')::text AS name")).rows[0].name, null);
    await db.exec('BEGIN READ ONLY');
    assert.ok((await db.exec(inspector)).length > 0);
    await db.exec('ROLLBACK');
    await db.exec(await readFile(migrationUrl, 'utf8'));
    assert.equal((await db.query('SELECT count(*)::int AS count FROM inventory_sales')).rows[0].count, 1);
    assert.equal((await db.query('SELECT stock FROM products WHERE id=1')).rows[0].stock, 10);
  });
  await t.test('new objects have expected constraints, indexes, owner, RLS and no direct client privileges', async () => {
    const tables = (await db.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('inventory_prediction_reviewers','inventory_prediction_sale_reviews','inventory_prediction_day_reviews')")).rows;
    assert.equal(tables.length, 3);
    assert.ok(tables.every(row => row.relrowsecurity));
    const functions = (await db.query("SELECT proname,prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'inventory_prediction_%'")).rows;
    assert.equal(functions.length, 4);
    assert.ok(functions.every(row => row.owner === 'postgres' && row.proconfig.includes('search_path=""')));
    assert.ok(functions.filter(row => row.proname !== 'inventory_prediction_immutable').every(row => row.prosecdef));
    const acl = (await db.query(`SELECT c.relname,r.rolname,has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed
      FROM pg_class c CROSS JOIN pg_roles r WHERE c.relnamespace='public'::regnamespace
      AND c.relkind='r' AND c.relname LIKE 'inventory_prediction_%' AND r.rolname IN ('anon','authenticated','service_role')`)).rows;
    assert.ok(acl.every(row => !row.allowed));
    const seq = (await db.query(`SELECT has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE') AS allowed
      FROM pg_class c CROSS JOIN pg_roles r WHERE c.relnamespace='public'::regnamespace
      AND c.relkind='S' AND c.relname LIKE 'inventory_prediction_%' AND r.rolname IN ('anon','authenticated','service_role')`)).rows;
    assert.equal(seq.length, 6);
    assert.ok(seq.every(row => !row.allowed));
    const indexNames = (await db.query("SELECT indexname FROM pg_indexes WHERE indexname IN ('prediction_sale_reviews_latest_idx','prediction_day_reviews_latest_idx')")).rows;
    assert.equal(indexNames.length, 2);
    const triggers = (await db.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('inventory_prediction_sale_reviews'::regclass,'inventory_prediction_day_reviews'::regclass)")).rows;
    assert.equal(triggers.length, 4);
    await assert.rejects(db.exec(await readFile(migrationUrl, 'utf8')), /PREDICTION_OBJECTS_ALREADY_PRESENT/);
    await db.exec('ROLLBACK');
  });
  const as = async user => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user ?? '']);
    await db.exec('SET ROLE authenticated');
  };
  await t.test('table privilege checks do not conceal separate PUBLIC column grants; RLS still denies rows', async () => {
    await db.exec('BEGIN');
    await db.query(`INSERT INTO public.inventory_prediction_sale_reviews(sale_id,kind,verified_at,verified_by,reference)
      VALUES($1,'test',clock_timestamp(),$2,'Synthetic private reference')`, [saleId, reviewer]);
    await db.exec('GRANT SELECT(reference) ON public.inventory_prediction_sale_reviews TO PUBLIC');
    const flags = (await db.query(`SELECT has_table_privilege('authenticated','public.inventory_prediction_sale_reviews','SELECT') AS table_access,
      has_column_privilege('authenticated','public.inventory_prediction_sale_reviews','reference','SELECT') AS column_access`)).rows[0];
    assert.equal(flags.table_access, false);
    assert.equal(flags.column_access, true);
    await db.exec('SET LOCAL ROLE authenticated');
    assert.deepEqual((await db.query('SELECT reference FROM public.inventory_prediction_sale_reviews')).rows, []);
    await db.exec('ROLLBACK');
  });
  const evidence = async asOf => (await db.query('SELECT public.inventory_prediction_evidence(coalesce($1::timestamptz,statement_timestamp())) AS data', [asOf ?? null])).rows[0].data;
  const classify = (kind, reference = 'Synthetic reviewer evidence') => db.query('SELECT public.inventory_prediction_classify_sale($1::uuid,$2,$3) AS id', [saleId, kind, reference]);
  const day = (availability, complete = true, productId = 1, value = '2025-01-01') => db.query(
    'SELECT public.inventory_prediction_review_day($1::bigint,$2::date,$3::boolean,$4,$5) AS id',
    [productId, value, complete, availability, 'Synthetic daily audit']);

  await t.test('migration seeds no authorization, sales classification or coverage', async () => {
    await as(member);
    assert.deepEqual(await evidence(), { classifications: [], coverage: [], stockouts: [] });
    await assert.rejects(classify('commercial'), /PREDICTION_FORBIDDEN/);
    await assert.rejects(day('available'), /PREDICTION_FORBIDDEN/);
    await assert.rejects(db.query('INSERT INTO public.inventory_prediction_reviewers(user_id) VALUES($1)', [member]), /permission denied/);
    await assert.rejects(db.exec('SELECT * FROM public.inventory_prediction_sale_reviews'), /permission denied/);
    await assert.rejects(db.exec('SELECT * FROM public.inventory_prediction_day_reviews'), /permission denied/);
  });
  await t.test('anonymous, expired and non-member sessions cannot read or classify', async () => {
    await as(outsider);
    await assert.rejects(evidence(), /PREDICTION_FORBIDDEN/);
    await assert.rejects(classify('commercial'), /PREDICTION_FORBIDDEN/);
    await as(null);
    await assert.rejects(evidence(), /PREDICTION_FORBIDDEN/);
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(evidence(), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE service_role');
    await assert.rejects(evidence(), /permission denied/);
    await assert.rejects(classify('commercial'), /permission denied/);
    await assert.rejects(db.exec('SELECT * FROM public.inventory_prediction_reviewers'), /permission denied/);
  });
  await t.test('temporary shadow tables cannot impersonate membership or reviewer authorization', async () => {
    await as(outsider);
    await db.exec(`CREATE TEMP TABLE inventory_members(user_id uuid); CREATE TEMP TABLE inventory_prediction_reviewers(user_id uuid);
      INSERT INTO pg_temp.inventory_members VALUES('${outsider}'); INSERT INTO pg_temp.inventory_prediction_reviewers VALUES('${outsider}');`);
    await assert.rejects(evidence(), /PREDICTION_FORBIDDEN/);
    await assert.rejects(classify('commercial'), /PREDICTION_FORBIDDEN/);
    await db.exec('RESET ROLE; DROP TABLE pg_temp.inventory_members; DROP TABLE pg_temp.inventory_prediction_reviewers');
  });
  await t.test('only an owner-assigned reviewer can append classifications, with server identity/time', async () => {
    await db.exec('RESET ROLE');
    await db.query('INSERT INTO public.inventory_prediction_reviewers VALUES($1)', [reviewer]);
    await as(reviewer);
    await classify('test', 'Synthetic private audit reference');
    const first = await evidence();
    assert.equal(first.classifications[0].kind, 'test');
    assert.equal(first.classifications[0].saleId, saleId);
    assert.ok(first.classifications[0].verifiedAt);
    assert.ok(!JSON.stringify(first).includes('private audit reference'));
    assert.ok(!JSON.stringify(first).includes(reviewer));
    assert.deepEqual(await evidence('2025-01-02T00:00:00Z'), { classifications: [], coverage: [], stockouts: [] });
    await classify('unclassified');
    assert.equal((await evidence()).classifications[0].kind, 'unclassified');
    await classify('commercial');
    assert.equal((await evidence()).classifications.length, 1);
    await db.exec('RESET ROLE');
    const history = (await db.query('SELECT kind,verified_by FROM inventory_prediction_sale_reviews ORDER BY id')).rows;
    assert.deepEqual(history.map(row => row.kind), ['test', 'unclassified', 'commercial']);
    assert.ok(history.every(row => row.verified_by === reviewer));
    await assert.rejects(db.exec("UPDATE inventory_prediction_sale_reviews SET kind='commercial'"), /PREDICTION_APPEND_ONLY/);
    await assert.rejects(db.exec('DELETE FROM inventory_prediction_sale_reviews'), /PREDICTION_APPEND_ONLY/);
    await assert.rejects(db.exec('TRUNCATE inventory_prediction_sale_reviews'), /PREDICTION_APPEND_ONLY/);
    await assert.rejects(db.exec('TRUNCATE inventory_prediction_day_reviews'), /PREDICTION_APPEND_ONLY/);
    await as(reviewer);
    await assert.rejects(classify('bogus'), /PREDICTION_INVALID_INPUT/);
    await assert.rejects(classify('commercial', ' '), /PREDICTION_INVALID_INPUT/);
    await assert.rejects(classify('commercial', '\t\n'), /PREDICTION_INVALID_INPUT/);
    await assert.rejects(db.query("SELECT inventory_prediction_classify_sale($1::uuid,'test','audit')", [outsider]), /PREDICTION_SALE_NOT_FOUND/);
  });
  await t.test('as-of reads exclude later verification using explicit synthetic historical audit instants', async () => {
    await db.exec('RESET ROLE');
    await db.query(`INSERT INTO inventory_prediction_sale_reviews(sale_id,kind,verified_at,verified_by,reference)
      VALUES($1,'test','2025-02-01T00:00:00Z',$2,'Synthetic historical audit'),
      ($1,'unclassified','2025-03-01T00:00:00Z',$2,'Synthetic later audit')`, [saleId, reviewer]);
    await as(member);
    assert.equal((await evidence('2025-02-15T00:00:00Z')).classifications[0].kind, 'test');
    assert.equal((await evidence('2025-03-15T00:00:00Z')).classifications[0].kind, 'unclassified');
    await as(reviewer);
  });
  await t.test('coverage requires recording AND availability; unknown and stockout do not become zero', async () => {
    await day('unknown');
    assert.deepEqual((await evidence()).coverage, []);
    await day('available', false);
    assert.deepEqual((await evidence()).coverage, []);
    await day('available');
    assert.equal((await evidence()).coverage.length, 1);
    await day('stockout');
    const result = await evidence();
    assert.equal(result.coverage.length, 0);
    assert.equal(result.stockouts.length, 1);
    assert.equal(result.stockouts[0].from, '2025-01-01');
    await day('unknown');
    assert.deepEqual((await evidence()).coverage, []);
    assert.deepEqual((await evidence()).stockouts, []);
    const today = (await db.query("SELECT (statement_timestamp() AT TIME ZONE 'America/Lima')::date::text AS day")).rows[0].day;
    await assert.rejects(day('available', true, 1, today), /PREDICTION_INVALID_INPUT/);
    await assert.rejects(day('available', true, 1, 'infinity'), /PREDICTION_INVALID_INPUT/);
    await assert.rejects(day('available', true, 9999), /PREDICTION_PRODUCT_NOT_FOUND/);
    await assert.rejects(db.query("SELECT inventory_prediction_review_day(1,'2025-01-01',true,'available',$1)", ['\t\n']), /PREDICTION_INVALID_INPUT/);
    await assert.rejects(evidence('9999-01-01T00:00:00Z'), /PREDICTION_INVALID_INPUT/);
  });
  await t.test('evidence survives product deletion and does not transfer to a recreated ID', async () => {
    await db.exec('RESET ROLE; DELETE FROM products WHERE id=1');
    await as(reviewer);
    await day('available'); // historical product is identifiable from its sales
    const result = await evidence();
    assert.equal(result.classifications[0].saleId, saleId);
    assert.equal(result.coverage[0].productId, 1);
    assert.ok(!result.coverage.some(row => row.productId === 2));
    await db.exec('RESET ROLE; INSERT INTO products VALUES(1,10)');
    const unchanged = (await db.query(`SELECT jsonb_build_object('sales',(SELECT jsonb_agg(s) FROM inventory_sales s),
      'products',(SELECT jsonb_agg(p ORDER BY id) FROM products p),'movements',(SELECT jsonb_agg(m) FROM inventory_movements m)) AS data`)).rows[0].data;
    assert.deepEqual(unchanged, originals);
  });
  await t.test('revocation removes write permission but preserves audit and member-only read', async () => {
    await db.query('DELETE FROM inventory_prediction_reviewers WHERE user_id=$1', [reviewer]);
    await as(reviewer);
    await assert.rejects(classify('commercial'), /PREDICTION_FORBIDDEN/);
    await assert.rejects(day('available'), /PREDICTION_FORBIDDEN/);
    assert.equal((await evidence()).classifications.length, 1);
    await as(member);
    assert.equal((await evidence()).classifications.length, 1);
  });
  await t.test('authorized projection feeds existing preparation and model contracts offline', async () => {
    await db.exec('RESET ROLE');
    await db.query('INSERT INTO inventory_prediction_reviewers VALUES($1)', [reviewer]);
    await db.exec(`INSERT INTO inventory_sales(id,product_id,created_at,quantity)
      SELECT md5('synthetic-sale-' || i::text)::uuid,7,
        (((statement_timestamp() AT TIME ZONE 'America/Lima')::date - 100 + i)::text || 'T15:00:00Z')::timestamptz,2
      FROM generate_series(0,99) i`);
    const rows = (await db.query(`SELECT id,product_id,created_at::text,quantity FROM inventory_sales WHERE product_id=7 ORDER BY created_at`)).rows;
    await as(reviewer);
    await db.exec(`SELECT inventory_prediction_classify_sale(md5('synthetic-sale-' || i::text)::uuid,'commercial','Synthetic classified fixture') FROM generate_series(0,99) i;
      SELECT inventory_prediction_review_day(7, (statement_timestamp() AT TIME ZONE 'America/Lima')::date - 100 + i,true,'available','Synthetic availability fixture') FROM generate_series(0,99) i;`);
    await as(member);
    const officialEvidence = await evidence();
    const now = (await db.query('SELECT statement_timestamp()::text AS time')).rows[0].time;
    const sales = rows.map(row => ({ id: row.id, productId: row.product_id, date: new Date(row.created_at).toISOString(),
      quantity: row.quantity, product: 'Synthetic historical product', sku: 'SYN-7', movementId: `synthetic-${row.id}` }));
    const view = preparePredictionView({ products: [{ id: 7, name: 'Synthetic current product', sku: 'SYN-7', isActive: true }],
      sales, salesEnabled: true, asOf: new Date(now).toISOString(), evidence: officialEvidence });
    const forecast = evaluatePredictionView(view, 7).forecasts.find(row => row.productId === 7);
    assert.equal(forecast.eligible, true);
    assert.equal(forecast.estimatedDemand, 14);
    // Technical retrospective fixture only; no claim about commercial precision.
  });
  await t.test('rollback refuses nonempty evidence and cannot erase the audit trail', async () => {
    await db.exec('RESET ROLE');
    const before = (await db.query('SELECT count(*)::int AS count FROM inventory_prediction_sale_reviews')).rows[0].count;
    await assert.rejects(db.exec(await readFile(rollbackUrl, 'utf8')), /PREDICTION_ROLLBACK_REQUIRES_EMPTY_INSTALLATION/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM inventory_prediction_sale_reviews')).rows[0].count, before);
  });
});
