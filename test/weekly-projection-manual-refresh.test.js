import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { createSnapshotStore } from '../lib/weekly-projection-snapshot.js';

const week = '2026-10-26', cutoff = '2026-10-27', origin = 'https://staging.test';
const routeSource = await readFile(new URL('../app/api/weekly-projections/results/route.js', import.meta.url), 'utf8');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Exercise the actual route/coordinator against local PostgreSQL.
// Commercial providers are injected; Azure credentials and network are never used.
async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec([
    'CREATE TABLE weekly_projection_results (',
    'week_start date NOT NULL,cutoff_date date NOT NULL,environment text NOT NULL,',
    'dimension text NOT NULL,scope_key text NOT NULL,sucursal_id bigint,persona_id bigint,',
    'payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),',
    'PRIMARY KEY(week_start,cutoff_date,environment,scope_key));',
    'CREATE TABLE forum_ventas_snapshot_v01 (period text,network text,dimension text,payload jsonb,',
    'generation_id text,sales_cutoff date,forum_cutoff date,updated_at timestamptz DEFAULT now());',
    "INSERT INTO forum_ventas_snapshot_v01 VALUES ('STATE','ALL','STATUS',",
    "'{\"status\":\"READY\",\"source_signature\":\"existing-source\"}',",
    "'existing-load','2026-10-26','2026-10-26',now());",
  ].join('\n'));
  const hooks = { beforeCalculation: async () => {}, failPublication: false };
  const timers = new Map();
  let calculationCount = 0, snapshots;
  const db = () => {
    const sql = (strings, ...values) => {
      let text = strings[0];
      for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1];
      if (text.includes('FROM sucursal_aliases')) return Promise.resolve([{ valor_raw: 'Test Store' }]);
      return pg.query(text, values).then(result => result.rows);
    };
    sql.query = (text, values) => pg.query(text, values).then(result => result.rows);
    return sql;
  };
  const withDbTransaction = work => pg.transaction(tx => work({
    query: (text, values) => {
      // PGlite serializes transactions on one connection; production SQL is otherwise unchanged.
      if (text.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
      if (hooks.failPublication && text.includes('sucursal_id,persona_id,payload,updated_at')) {
        throw new Error('simulated publication failure');
      }
      return tx.query(text, values);
    },
  }));
  const json = data => Response.json(data);
  const admin = () => ({
    sales_mtd: { total_units: 2, details: [{ vin: 'VIN1', persona_id: '5', vendedor: 'Seller' }] },
    historical_context: { periods: [] }, next_cut_context: {},
  });
  const brands = Object.fromEntries(['sales', 'weekly_sales', 'quotations', 'approved', 'ufis', 'other_credits', 'precurse']
    .map(name => [name, { foton: 1, dongfeng: 1, source: 'fixture P1', evidence_ids: ['fixture-evidence'] }]));
  const precurse = {
    company: { payload: { value: 0 }, temporal: { snapshot_date: cutoff } },
    dimensions: {
      STORE: { payload: { members: [] }, coverage: { dimension_unresolved_value: 0 } },
      SELLER: { payload: { members: [] }, coverage: { dimension_unresolved_value: 0 } },
    },
    sellers_by_store: {},
  };
  const context = {
    NextResponse: { json: (data, options) => Response.json(data, options) },
    Request, URL, URLSearchParams, AbortSignal, process: { env: { PROJECTIONS_ENVIRONMENT: 'staging' } },
    console: { info() {}, error() {} }, db, withDbTransaction,
    createSnapshotStore: options => (snapshots = createSnapshotStore(options)),
    getBranches: async () => {
      calculationCount++;
      await hooks.beforeCalculation(calculationCount);
      return json({ ok: true, sucursales: [{ sucursal_id: '1', nombre_canonico: 'Test Store' }] });
    },
    getAdmin: async () => json({ ok: true, ...admin(), scopes: { '1': admin() } }),
    getCompanyFinance: async () => json({
      ok: true, periods: [], stores: [{ sucursal_id: '1' }], scopes: { '1': { periods: [], stores: [] } },
    }),
    getForumSellers: async () => json({
      ok: true, aliases: [], forum: [], sellers: [{ sucursal_id: '1', persona_id: '5' }],
    }),
    getProjections: async () => { throw new Error('unexpected live read'); },
    getNotInvoiced: async () => { throw new Error('unexpected live read'); },
    mockedBrands: async () => structuredClone(brands),
    mockedPrecurse: async () => structuredClone(precurse),
    setInterval: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.set(timer, timer);
      return timer;
    },
    clearInterval: timer => timers.delete(timer),
    fetch: () => { throw new Error('NETWORK_FORBIDDEN'); },
  };
  const source = routeSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const route = vm.runInNewContext(source +
    '\ngetP1BrandIndicators = mockedBrands;\ngetPrecurseBundle = mockedPrecurse;\n({ GET, POST });', context);
  const post = async (body = {}) => {
    const response = await route.POST(new Request(origin + '/api/weekly-projections/results', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ week_start: week, cutoff_date: cutoff, ...body }),
    }));
    return { status: response.status, data: await response.json() };
  };
  const status = async () => {
    const response = await route.GET(new Request(origin +
      '/api/weekly-projections/results?week_start=' + week + '&cutoff_date=' + cutoff + '&status=1'));
    return response.json();
  };
  const rows = async () => (await pg.query(
    "SELECT scope_key,payload,updated_at::text FROM weekly_projection_results WHERE scope_key<>'REFRESH_STATUS' ORDER BY scope_key",
  )).rows;
  const expire = () => pg.query("UPDATE weekly_projection_results SET " +
    "payload=jsonb_set(payload,'{lease_until}',to_jsonb((now()-interval '1 second')::text)) WHERE scope_key='REFRESH_STATUS'");
  return { pg, hooks, timers, post, status, rows, expire, brands,
    get calculations() { return calculationCount; }, get snapshots() { return snapshots; } };
}

test('manual route rejects duplicate live executions, renews the lease and refreshes unchanged sources', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.hooks.beforeCalculation = async () => { entered.resolve(); await release.promise; };
  const first = f.post();
  await entered.promise;
  const running = await f.status();
  assert.equal(running.status, 'running');
  const duplicate = await f.post();
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.data.job_id, running.job_id);
  assert.equal(f.calculations, 1);
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 30_000);
  await f.pg.query("UPDATE weekly_projection_results SET " +
    "payload=jsonb_set(payload,'{lease_until}',to_jsonb((now()+interval '1 minute')::text)) WHERE scope_key='REFRESH_STATUS'");
  const before = await f.status();
  timer.callback();
  const renewed = await f.status();
  assert.ok(Date.parse(renewed.lease_until) > Date.parse(before.lease_until) + 120_000);
  release.resolve();
  assert.equal((await first).status, 200);
  assert.equal(f.timers.size, 0);
  const again = await f.post();
  assert.equal(again.status, 200);
  assert.notEqual(again.data.job_id, running.job_id);
  assert.equal(again.data.skipped, false);
  assert.equal(f.calculations, 2);
  const saved = await f.rows();
  assert.equal(saved.length, 3);
  for (const row of saved.filter(row => row.scope_key !== 'SELLER:1:5')) {
    assert.deepEqual(row.payload.admin.brand_indicators, f.brands);
    assert.deepEqual(row.payload.companyFinance.brand_indicators, f.brands);
  }
  assert.equal(saved.find(row => row.scope_key === 'STORE:1').payload.admin.previous_month_sales.length, 1);
  assert.equal((await f.post({ automatic: true })).status, 400);
  assert.equal(f.calculations, 2);
});

test('manual route recovers a legacy orphan without job_id or lease_until', async t => {
  const f = await fixture(t);
  await f.pg.query('INSERT INTO weekly_projection_results ' +
    '(week_start,cutoff_date,environment,dimension,scope_key,payload,updated_at) ' +
    "VALUES ($1::date,$2::date,'staging','COMPANY','REFRESH_STATUS',$3::jsonb,now()-interval '6 minutes')",
  [week, cutoff, JSON.stringify({
    status: 'running', started_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    completedStores: 0, totalStores: 15,
  })]);
  assert.equal((await f.status()).status, 'expired');
  const recovered = await f.post();
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.status, 'completed');
  assert.ok(recovered.data.job_id);
  assert.equal(recovered.data.completedStores, 1);
});

test('a replaced worker cannot publish, renew or mark its successor as failed', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.hooks.beforeCalculation = async count => { if (count === 1) { entered.resolve(); await release.promise; } };
  const oldRequest = f.post();
  await entered.promise;
  const oldJob = await f.status();
  await f.expire();
  const successor = await f.post();
  assert.equal(successor.status, 200);
  const saved = await f.rows(), completed = await f.status();
  assert.notEqual(completed.job_id, oldJob.job_id);
  await assert.rejects(f.snapshots.publish(week, cutoff, 'staging', oldJob, []), /REFRESH_LEASE_LOST/);
  await assert.rejects(f.snapshots.update(week, cutoff, 'staging', oldJob), /REFRESH_LEASE_LOST/);
  release.resolve();
  const obsolete = await oldRequest;
  assert.equal(obsolete.status, 500);
  assert.equal(obsolete.data.error, 'REFRESH_LEASE_LOST');
  assert.deepEqual(await f.status(), completed);
  assert.deepEqual(await f.rows(), saved);
  assert.equal(f.timers.size, 0);
});

test('calculation and publication errors preserve every row of the last valid snapshot', async t => {
  const f = await fixture(t);
  assert.equal((await f.post()).status, 200);
  const saved = await f.rows();
  f.hooks.beforeCalculation = async () => { throw new Error('simulated calculation failure'); };
  assert.equal((await f.post()).data.error, 'simulated calculation failure');
  assert.equal((await f.status()).status, 'failed');
  assert.deepEqual(await f.rows(), saved);
  f.hooks.beforeCalculation = async () => {};
  f.hooks.failPublication = true;
  const failure = await f.post();
  assert.equal(failure.status, 500);
  assert.equal(failure.data.error, 'simulated publication failure');
  assert.equal((await f.status()).status, 'failed');
  assert.deepEqual(await f.rows(), saved);
  assert.equal(f.timers.size, 0);
});
