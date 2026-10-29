// Explicit opt-in harness for a newly initialized, disposable PostgreSQL cluster.
// Never reads .env; no remote connection strings are accepted.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [bin, cluster, portText] = process.argv.slice(2);
assert.ok(bin && cluster && /^\d+$/.test(portText), 'Usage: node prediction_evidence_postgres.mjs PG_BIN DISPOSABLE_CLUSTER PORT');
const data = realpathSync(path.join(cluster, 'data'));
assert.match(path.basename(cluster), /^\.eagle-phase6-pg-/, 'Only a dedicated Phase 6 cluster is accepted');
const options = readFileSync(path.join(data, 'postmaster.opts'), 'utf8');
assert.ok(options.includes('127.0.0.1') && options.includes(portText), 'Local cluster launch options required');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = name => readFileSync(path.join(here, name), 'utf8');
const migration = sql('20261027_prediction_evidence.proposed.sql');
const rollback = sql('20261027_prediction_evidence.rollback.proposed.sql');
const database = 'eagle_phase6_synthetic';
function psql(statement, db = database) {
  return execFileSync(path.join(bin, 'psql.exe'), ['-X', '-h', '127.0.0.1', '-p', portText,
    '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'],
  { input: statement, encoding: 'utf8', env, timeout: 60000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const identity = JSON.parse(psql(`SELECT json_build_object('directory',current_setting('data_directory'),
  'host',inet_server_addr(),'port',inet_server_port(),'user',current_user,'version',version());`, 'postgres'));
assert.equal(realpathSync(identity.directory), data);
assert.equal(identity.host, '127.0.0.1');
assert.equal(identity.port, Number(portText));
assert.equal(identity.user, 'postgres');
console.log('ISOLATION', JSON.stringify(identity));
psql(`CREATE DATABASE ${database};`, 'postgres'); // Deliberately refuses an existing database.
let passed = 0;
function check(name, action) { action(); passed++; console.log(`PASS ${passed}: ${name}`); }
function fails(statement, pattern) {
  assert.throws(() => psql(statement), error => pattern.test(String(error.stderr)), `Expected ${pattern}`);
}
function json(statement) { return JSON.parse(psql(statement)); }
const reviewer = '00000000-0000-4000-8000-000000000001';
const member = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const saleId = '10000000-0000-4000-8000-000000000001';
// Reuse exactly the synthetic contracts of the existing PGlite suite.
const source = readFileSync(path.join(here, '..', 'predictionEvidenceSql.test.js'), 'utf8');
const fixture = source.match(/const fixture = `([\s\S]*?)`;/)[1]
  .replaceAll('${reviewer}', reviewer).replaceAll('${member}', member)
  .replaceAll('${outsider}', outsider).replaceAll('${saleId}', saleId);
psql(fixture + `
GRANT SELECT ON products,inventory_sales,inventory_members TO authenticated;
CREATE POLICY synthetic_member_read ON inventory_members FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY synthetic_sales_read ON inventory_sales FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM inventory_members WHERE user_id=auth.uid()));
CREATE POLICY synthetic_products_read ON products FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM inventory_members WHERE user_id=auth.uid()));
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC,anon,authenticated,service_role;
`);
const snapshot = () => json(`SELECT jsonb_build_object(
 'sales',(SELECT jsonb_agg(s ORDER BY id) FROM inventory_sales s),
 'products',(SELECT jsonb_agg(p ORDER BY id) FROM products p),
 'members',(SELECT jsonb_agg(m ORDER BY user_id) FROM inventory_members m),
 'users',(SELECT jsonb_agg(u ORDER BY id) FROM auth.users u),
 'movements',(SELECT jsonb_agg(m ORDER BY id) FROM inventory_movements m),
 'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),
 'acl',(SELECT jsonb_agg(jsonb_build_array(relname,relacl,relrowsecurity) ORDER BY relname)
 FROM pg_class WHERE oid IN ('products'::regclass,'inventory_sales'::regclass,'inventory_members'::regclass,'inventory_movements'::regclass,'auth.users'::regclass)),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p));`);
const original = snapshot();
const as = (role, user, statement) => `SET ROLE ${role}; SET request.jwt.claim.sub='${user ?? ''}'; ${statement}`;
const read = `SELECT inventory_prediction_evidence();`;
const classify = (kind = 'commercial', reference = 'Synthetic audit') => `SELECT inventory_prediction_classify_sale('${saleId}','${kind}','${reference}');`;
const day = (availability, complete = true, date = '2025-01-01') => `SELECT inventory_prediction_review_day(1,'${date}',${complete},'${availability}','Synthetic daily audit');`;
const evidence = () => json(as('authenticated', member, read));
const absent = () => assert.equal(psql("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'inventory_prediction_%';"), '0');

check('late ACL failure rolls back all DDL and preserves defaults, original data and policies', () => {
  psql(`CREATE ROLE synthetic_acl_parent; GRANT synthetic_acl_parent TO authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO synthetic_acl_parent;`);
  const before = snapshot();
  fails(migration, /PREDICTION_EFFECTIVE_ACL_DRIFT/);
  absent();
  assert.equal(psql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'inventory_prediction_%';"), '0');
  assert.deepEqual(snapshot(), before);
  psql(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM synthetic_acl_parent;
    REVOKE synthetic_acl_parent FROM authenticated; DROP ROLE synthetic_acl_parent;`);
  assert.deepEqual(snapshot(), original);
});
check('migration commits with broad S2 table, sequence and function defaults', () => psql(migration));
check('three RLS tables, two identity sequences, two indexes, four functions and four audit triggers exist', () => {
  assert.equal(psql("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE 'inventory_prediction_%' AND relrowsecurity;"), '3');
  assert.equal(psql("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='S' AND relname LIKE 'inventory_prediction_%';"), '2');
  assert.equal(psql("SELECT count(*) FROM pg_indexes WHERE indexname IN ('prediction_sale_reviews_latest_idx','prediction_day_reviews_latest_idx');"), '2');
  assert.equal(psql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'inventory_prediction_%' AND pg_get_userbyid(proowner)='postgres' AND proconfig @> ARRAY['search_path=\"\"'];"), '4');
  assert.equal(psql("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('inventory_prediction_sale_reviews'::regclass,'inventory_prediction_day_reviews'::regclass);"), '4');
  assert.equal(psql("SELECT count(*) FROM pg_constraint WHERE conrelid IN ('inventory_prediction_reviewers'::regclass,'inventory_prediction_sale_reviews'::regclass,'inventory_prediction_day_reviews'::regclass);"), '11');
});
check('PUBLIC and client roles lose all direct relation/sequence ACL including columns; EXECUTE is confined', () => {
  assert.equal(psql(`SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'inventory_prediction_%' AND a.grantee=0;`), '0');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(psql(`SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace
      AND relname LIKE 'inventory_prediction_%' AND relkind='r' AND
      (has_table_privilege('${role}',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege('${role}',oid,'SELECT,INSERT,UPDATE,REFERENCES'));`), '0');
    assert.equal(psql(`SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace
      AND relname LIKE 'inventory_prediction_%' AND CASE WHEN relkind='S' THEN has_sequence_privilege('${role}',oid,'USAGE,SELECT,UPDATE') ELSE false END;`), '0');
    assert.equal(psql(`SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'inventory_prediction_%' AND has_function_privilege('${role}',oid,'EXECUTE');`), role === 'authenticated' ? '3' : '0');
  }
  assert.equal(psql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'inventory_prediction_%' AND prosecdef;"), '3');
});
check('empty installation rollback removes every new relation/function and preserves originals', () => {
  psql(rollback); absent();
  assert.equal(psql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'inventory_prediction_%';"), '0');
  assert.deepEqual(snapshot(), original);
  psql(migration);
});
check('inspector executes in a read-only transaction', () => psql(`BEGIN READ ONLY; ${sql('20261027_prediction_evidence.inspect.sql')} ROLLBACK;`));
check('clients cannot SELECT, INSERT, UPDATE, DELETE, TRUNCATE, self-assign or use sequences', () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of ['inventory_prediction_reviewers', 'inventory_prediction_sale_reviews', 'inventory_prediction_day_reviews']) {
      for (const statement of [`SELECT * FROM ${table}`, `INSERT INTO ${table} DEFAULT VALUES`,
        `UPDATE ${table} SET ${table.endsWith('reviewers') ? 'user_id=user_id' : 'reference=reference'}`,
        `DELETE FROM ${table}`, `TRUNCATE ${table}`]) fails(as(role, member, statement), /permission denied/);
    }
    for (const sequence of ['inventory_prediction_sale_reviews_id_seq', 'inventory_prediction_day_reviews_id_seq']) {
      for (const statement of [`SELECT nextval('${sequence}')`, `SELECT * FROM ${sequence}`, `SELECT setval('${sequence}',100)`]) fails(as(role, member, statement), /permission denied/);
    }
  }
  fails(as('authenticated', member, `INSERT INTO inventory_prediction_reviewers VALUES('${member}')`), /permission denied/);
});
check('anonymous, service role, missing identity and nonmember requests are rejected', () => {
  for (const role of ['anon', 'service_role']) for (const statement of [read, classify(), day('available')]) fails(as(role, reviewer, statement), /permission denied/);
  for (const user of [null, outsider]) for (const statement of [read, classify(), day('available')]) fails(as('authenticated', user, statement), /PREDICTION_FORBIDDEN/);
  assert.deepEqual(evidence(), { classifications: [], coverage: [], stockouts: [] });
  fails(as('authenticated', member, classify()), /PREDICTION_FORBIDDEN/);
  fails(as('authenticated', member, day('available')), /PREDICTION_FORBIDDEN/);
});
check('only owner-assigned reviewer classifies test/commercial sales; history and sanitized read survive corrections', () => {
  psql(`INSERT INTO inventory_prediction_reviewers VALUES('${reviewer}');`);
  fails(rollback, /PREDICTION_ROLLBACK_REQUIRES_EMPTY_INSTALLATION/);
  for (const kind of ['test', 'unclassified', 'commercial']) psql(as('authenticated', reviewer, classify(kind)));
  assert.deepEqual(json('SELECT json_agg(kind ORDER BY id) FROM inventory_prediction_sale_reviews;'), ['test', 'unclassified', 'commercial']);
  assert.equal(psql(`SELECT bool_and(verified_by='${reviewer}' AND verified_at<=clock_timestamp()) FROM inventory_prediction_sale_reviews;`), 't');
  assert.equal(evidence().classifications[0].kind, 'commercial');
  assert.ok(!JSON.stringify(evidence()).includes(reviewer));
  assert.ok(!JSON.stringify(evidence()).includes('Synthetic audit'));
  for (const statement of [classify('invalid'), classify('commercial', ' '), day('invalid'), day('available', true, 'infinity')]) fails(as('authenticated', reviewer, statement), /PREDICTION_INVALID_INPUT/);
  fails(as('authenticated', reviewer, `SELECT inventory_prediction_classify_sale('${outsider}','test','Synthetic')`), /PREDICTION_SALE_NOT_FOUND/);
  fails(as('authenticated', reviewer, `SELECT inventory_prediction_review_day(999,'2025-01-01',true,'available','Synthetic')`), /PREDICTION_PRODUCT_NOT_FOUND/);
});
check('recording and availability determine coverage; stockouts and unknown stay distinct', () => {
  for (const [availability, complete, coverage, stockouts] of [['unknown',true,0,0],['available',false,0,0],['available',true,1,0],['stockout',true,0,1],['unknown',true,0,0]]) {
    psql(as('authenticated', reviewer, day(availability, complete)));
    assert.equal(evidence().coverage.length, coverage); assert.equal(evidence().stockouts.length, stockouts);
  }
  fails(as('authenticated', reviewer, `SELECT inventory_prediction_review_day(1,(statement_timestamp() AT TIME ZONE 'America/Lima')::date,true,'available','Synthetic')`), /PREDICTION_INVALID_INPUT/);
});
check('owner cannot mutate/truncate audit; rollback refuses existing evidence atomically', () => {
  for (const table of ['inventory_prediction_sale_reviews', 'inventory_prediction_day_reviews']) {
    for (const statement of [`UPDATE ${table} SET reference='changed'`, `DELETE FROM ${table}`, `TRUNCATE ${table}`]) fails(statement, /PREDICTION_APPEND_ONLY/);
  }
  const before = psql('SELECT count(*) FROM inventory_prediction_sale_reviews;');
  fails(rollback, /PREDICTION_ROLLBACK_REQUIRES_EMPTY_INSTALLATION/);
  assert.equal(psql('SELECT count(*) FROM inventory_prediction_sale_reviews;'), before);
});
check('revoking reviewer preserves audit and member read while removing write access', () => {
  psql(`DELETE FROM inventory_prediction_reviewers WHERE user_id='${reviewer}';`);
  fails(as('authenticated', reviewer, classify()), /PREDICTION_FORBIDDEN/);
  fails(as('authenticated', reviewer, day('available')), /PREDICTION_FORBIDDEN/);
  assert.equal(evidence().classifications.length, 1);
});
check('original synthetic data, unrelated privileges, policies and broad defaults remain identical', () => assert.deepEqual(snapshot(), original));
console.log(`RESULT: ${passed} PostgreSQL checks passed. Disposable cluster must now be stopped.`);
