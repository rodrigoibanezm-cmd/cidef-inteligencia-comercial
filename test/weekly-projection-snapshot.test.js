import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createSnapshotStore, reportingDates, liveLease } from '../lib/weekly-projection-snapshot.js';

// Real PostgreSQL SQL, entirely in memory. No Azure URL or network connection.
async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE weekly_projection_results (
    week_start date NOT NULL,cutoff_date date NOT NULL,environment text NOT NULL,
    dimension text NOT NULL,scope_key text NOT NULL,sucursal_id bigint,persona_id bigint,
    payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(week_start,cutoff_date,environment,scope_key));
    CREATE TABLE forum_ventas_snapshot_v01 (period text,network text,dimension text,payload jsonb,
      generation_id text,sales_cutoff date,forum_cutoff date,updated_at timestamptz DEFAULT now());`);
  const client = tx => ({ query: (sql, args) => sql.includes('pg_advisory_xact_lock')
    ? Promise.resolve({ rows: [] }) // Single-connection WASM serializes transactions.
    : tx.query(sql, args) });
  const clock = { now: Date.now() };
  const store = createSnapshotStore({ db: () => ({ query: (sql, args) => pg.query(sql, args).then(r => r.rows) }),
    withDbTransaction: work => pg.transaction(tx => work(client(tx))), now: () => clock.now });
  const source = async (signature = 'sales-v1', generation = 'load-sales-1', status = 'READY') => {
    await pg.query('DELETE FROM forum_ventas_snapshot_v01');
    await pg.query(`INSERT INTO forum_ventas_snapshot_v01
      (period,network,dimension,payload,generation_id,sales_cutoff,forum_cutoff)
      VALUES ('STATE','ALL','STATUS',$1::jsonb,$2,'2026-10-21','2026-10-20')`,
    [JSON.stringify({ status, source_signature: signature }), generation]);
    return store.sources();
  };
  const payload = value => ({ admin: { sales_mtd: { total_units: value } }, companyFinance: {} });
  const rows = value => [
    { dimension: 'COMPANY', scopeKey: 'COMPANY', payload: payload(value), storeId: null, personId: null },
    { dimension: 'STORE', scopeKey: 'STORE:1', payload: payload(value), storeId: '1', personId: null },
    { dimension: 'SELLER', scopeKey: 'SELLER:1:5', payload: { forum: { ufi: value } }, storeId: '1', personId: '5' },
  ];
  const claim = async (src, day = '2026-10-22') => {
    const job = await store.claim('2026-10-19', day, 'staging', src);
    job.totalStores = 1;
    return job;
  };
  const publish = (job, value, day = '2026-10-22') => store.publish('2026-10-19', day, 'staging', job, rows(value));
  return { pg, store, source, rows, claim, publish, clock };
}

test('Santiago date, Sunday/Monday, DST, month and year boundaries', () => {
  assert.deepEqual(reportingDates(new Date('2026-10-26T02:59:00Z')), { weekStart: '2026-10-19', cutoffDate: '2026-10-25' });
  assert.deepEqual(reportingDates(new Date('2026-10-26T03:01:00Z')), { weekStart: '2026-10-26', cutoffDate: '2026-10-26' });
  assert.deepEqual(reportingDates(new Date('2026-11-01T15:00:00Z')), { weekStart: '2026-10-26', cutoffDate: '2026-11-01' });
  assert.deepEqual(reportingDates(new Date('2027-01-01T01:00:00Z')), { weekStart: '2026-12-28', cutoffDate: '2026-12-31' });
  assert.equal(reportingDates(new Date('2026-07-06T03:30:00Z')).cutoffDate, '2026-07-05');
  assert.equal(liveLease({ status: 'running', started_at: 'invalid' }, 'invalid'), false);
});

test('only successful READY publications are available as source signals', async t => {
  const f = await fixture(t);
  assert.equal((await f.source('a', 'run1', 'BUILDING')).status, 'BUILDING');
  assert.equal((await f.source('a', 'run1', 'FAILED')).status, 'FAILED');
  const source = await f.source();
  assert.equal(source.source_signature, 'sales-v1');
  assert.equal(source.generation_id, 'load-sales-1');
  assert.equal(source.sales_cutoff, '2026-10-21');
});

test('SALES then FORUM replace the same daily photo; unchanged sources do not recalculate', async t => {
  const f = await fixture(t);
  const first = await f.claim(await f.source());
  assert.equal(first.claimed, true);
  await f.publish(first, 10);
  const before = await f.store.latest('2026-10-19', '2026-10-22', 'staging', null);
  const repeat = await f.claim(await f.source('sales-v1', 'identical-load'));
  assert.equal(repeat.skipped, true);
  assert.equal(repeat.claimed, false);
  assert.deepEqual(await f.store.latest('2026-10-19', '2026-10-22', 'staging', null), before);
  const forum = await f.claim(await f.source('forum-v2', 'load-forum-2'));
  await f.publish(forum, 11);
  const after = await f.store.latest('2026-10-19', '2026-10-22', 'staging', null);
  assert.equal(after.find(r => r.scope_key === 'COMPANY').payload.admin.sales_mtd.total_units, 11);
  assert.equal((await f.pg.query("SELECT count(*)::int n FROM weekly_projection_results WHERE cutoff_date='2026-10-22'")).rows[0].n, 4);
  assert.equal((await f.store.status('2026-10-19', '2026-10-22', 'staging')).sources.generation_id, 'load-forum-2');
});

test('daily history, environment isolation, cutoff fallback and company/store navigation', async t => {
  const f = await fixture(t);
  const old = await f.claim(await f.source(), '2026-10-21');
  await f.publish(old, 10, '2026-10-21');
  const current = await f.claim(await f.source('v2', 'run2'));
  await f.publish(current, 12);
  await f.pg.query("INSERT INTO weekly_projection_results VALUES ('2026-10-19','2026-10-22','production','COMPANY','COMPANY',null,null,'{\"untouched\":true}',now())");
  const company = await f.store.latest('2026-10-19', '2026-10-23', 'staging', null);
  const store = await f.store.latest('2026-10-19', '2026-10-23', 'staging', '1');
  assert.equal(company[0].cutoff_date, '2026-10-22');
  assert.deepEqual(store.map(r => r.scope_key), ['SELLER:1:5', 'STORE:1']);
  assert.ok([...company, ...store].every(r => r.payload.snapshot.generation_id === current.job_id));
  assert.deepEqual(await f.store.latest('2026-10-19', '2026-10-23', 'staging', null), company);
  assert.equal((await f.store.latest('2026-10-19', '2026-10-21', 'staging', null))[0].payload.admin.sales_mtd.total_units, 10);
  assert.equal((await f.pg.query("SELECT payload FROM weekly_projection_results WHERE environment='production'")).rows[0].payload.untouched, true);
  await assert.rejects(f.store.claim('2026-10-19', '2026-10-22', 'production', await f.source()), /STAGING_ONLY/);
});

test('calculation failure, source change and insert failure retain every previous dimension', async t => {
  const f = await fixture(t);
  await f.publish(await f.claim(await f.source()), 10);
  const saved = await f.store.latest('2026-10-19', '2026-10-22', 'staging', null);
  const job = await f.claim(await f.source('new', 'new-run'));
  await f.store.update('2026-10-19', '2026-10-22', 'staging', { ...job, status: 'failed', error: 'simulated motor failure' });
  assert.deepEqual(await f.store.latest('2026-10-19', '2026-10-22', 'staging', null), saved);
  const retry = await f.claim(await f.source('new', 'new-run'));
  const broken = f.rows(999); broken[1].scopeKey = 'COMPANY';
  await assert.rejects(f.store.publish('2026-10-19', '2026-10-22', 'staging', retry, broken), /duplicate key/);
  assert.deepEqual(await f.store.latest('2026-10-19', '2026-10-22', 'staging', null), saved);
  await f.source('changed-again', 'next-run');
  await assert.rejects(f.publish(retry, 999), /SOURCES_CHANGED/);
  assert.deepEqual(await f.store.latest('2026-10-19', '2026-10-22', 'staging', null), saved);
});

test('one owner, heartbeat, expired recovery, and fencing against a resurrected worker', async t => {
  const f = await fixture(t);
  const source = await f.source();
  const first = await f.claim(source);
  const other = await f.claim(source);
  assert.equal(other.claimed, false);
  assert.equal(other.job_id, first.job_id);
  await f.store.update('2026-10-19', '2026-10-22', 'staging', first);
  f.clock.now += 6 * 60_000;
  assert.equal((await f.store.status('2026-10-19', '2026-10-22', 'staging')).status, 'expired');
  const recovered = await f.claim(source);
  assert.equal(recovered.claimed, true);
  assert.notEqual(recovered.job_id, first.job_id);
  await assert.rejects(f.publish(first, 999), /REFRESH_LEASE_LOST/);
  await assert.rejects(f.store.update('2026-10-19', '2026-10-22', 'staging', first), /REFRESH_LEASE_LOST/);
  await f.publish(recovered, 20);
});
