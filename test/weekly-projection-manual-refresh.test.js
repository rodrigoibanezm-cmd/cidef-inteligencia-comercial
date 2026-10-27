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
    mockedBrands: async () => ({ company: structuredClone(brands), stores: { "1": structuredClone(brands) } }),
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

function groupedFixture(cutDate = cutoff, previousWeek = false) {
  const ids = Array.from({ length: 15 }, (_, i) => String(i + 1));
  const rows = ids.slice(0, 14).flatMap(id => [
    { vin: 'F' + id, sale_date: cutDate, brand_id: '89', store_id: id, financial_entity: id === '2' ? null : 'FORUM' },
    { vin: 'D' + id, sale_date: '2026-10-01', brand_id: '71', store_id: id, financial_entity: 'BANK' },
  ]).concat([
    { vin: 'OTHER', sale_date: cutDate, brand_id: null, store_id: '1', financial_entity: 'FORUM' },
    { vin: 'NO_STORE', sale_date: cutDate, brand_id: '89', store_id: null, financial_entity: 'FORUM' },
  ]);
  if (previousWeek) rows.push({ vin: 'SEPTEMBER', sale_date: '2026-09-29', brand_id: '89', store_id: '15', financial_entity: 'FORUM' });
  const monthly = rows.filter(row => row.sale_date >= '2026-10-01');
  const grouped = (keys, source) => {
    const result = new Map();
    for (const row of source) {
      const tuple = keys.map(key => String(row[key] ?? 'UNRESOLVED'));
      const key = JSON.stringify(tuple), entry = result.get(key) || { tuple, value: 0 };
      entry.value++; result.set(key, entry);
    }
    return [...result.values()];
  };
  const certified = (id, payload) => ({ evidence_id: id, authority: 'P1_CERTIFIED', status: 'CERTIFIED',
    temporal: { date_from: '2026-10-01', date_to: cutDate }, payload });
  const brandEvidence = certified('brands', { members: grouped(['brand_id'], monthly).map(row => ({
    members: [{ dimension: 'BRAND', member_id: row.tuple[0], member_label: { '89': 'FOTON', '71': 'DONGFENG' }[row.tuple[0]] || 'No resuelto' },
      { dimension: 'NETWORK', member_id: 'TIENDA_PROPIA', member_label: 'TIENDA_PROPIA' }], value: row.value,
  })) });
  const financeEvidence = certified('finance', { members: grouped(['store_id', 'financial_entity'], monthly).map(row => ({
    members: ['STORE', 'FINANCIAL_ENTITY'].map((dimension, i) => ({ dimension, member_id: row.tuple[i] })), value: row.value,
  })) });
  const calls = [], hooks = {};
  const callP1Tool = async (runId, name, args) => {
    calls.push({ name, args });
    assert.ok(!args.filters?.store && !args.filters?.store_id, 'never query one store');
    if (name === 'sales_observe_many') return { results: [
      { operation: { kind: 'TOTAL' }, evidence: certified('total', { value: monthly.length }) },
      { operation: { kind: 'BRAND_NETWORK' }, evidence: brandEvidence },
      { operation: { kind: 'STORE_FINANCIAL_ENTITY' }, evidence: financeEvidence },
    ] };
    if (name === 'data_fetch') return { source: 'SALES', dataset: 'SALES_WORK', grain: 'RECOGNIZED_SALE',
      version: '0.13', size: { filtered_n: rows.length }, rows: hooks.truncate ? rows.slice(1) : rows };
    assert.equal(name, 'data_observe'); assert.equal(args.source, 'FORUM'); assert.equal(args.dimension, 'STORE');
    const members = args.filters.brand_id === '89'
      ? [{ member_id: '1', value: 1 }, { member_id: 'UNRESOLVED:RAW', value: 1 }]
      : args.filters.brand_id === '71'
        ? [{ member_id: '1', value: 1 }, { member_id: '2', value: 1 }, { member_id: 'UNRESOLVED:RAW', value: 1 }]
        : [{ member_id: '1', value: 3 }, { member_id: '2', value: 1 }, { member_id: 'UNRESOLVED:RAW', value: 2 }];
    if (hooks.uncertified) return { payload: { members } };
    return { ...certified(args.measure + ':' + (args.filters.brand_id || 'ALL'), { members }),
      temporal: args.measure === 'PRECURSE' ? { snapshot_date: hooks.stale && args.filters.brand_id ? '2026-10-26' : cutDate } : { to: cutDate } };
  };
  const source = routeSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const context = { db() {}, withDbTransaction() {}, createSnapshotStore: () => ({}), console, AbortSignal };
  const get = vm.runInNewContext(source + '\ncallP1Tool = mockedCall; getP1BrandIndicators;', { ...context, mockedCall: callP1Tool });
  return { ids, calls, hooks, brandEvidence, financeEvidence, get: () => get('2026-10', cutDate, ids) };
}

test('weekly brand sales span the month boundary without entering monthly sales or financing', async () => {
  const f = groupedFixture('2026-10-03', true), result = await f.get();
  assert.equal(f.calls.find(call => call.name === 'data_fetch').args.filters.date_from, '2026-09-27');
  assert.equal(result.company.sales.company, 30);
  assert.equal(result.company.weekly_sales.company, 30);
  assert.equal(result.company.ufis.company, 14);
  assert.equal(result.stores['15'].sales.company, 0);
  assert.equal(result.stores['15'].weekly_sales.foton, 1);
  assert.equal(result.stores['15'].ufis.company, 0);
});

test('one grouped P1 bundle serves all 15 stores and preserves all seven brand indicators', async () => {
  const f = groupedFixture(), result = await f.get();
  assert.equal(f.calls.length, 11); // 2 SALES + 9 FORUM, independent of store count.
  assert.equal(Object.keys(result.stores).length, 15);
  assert.equal(result.company.sales.company, 30);
  assert.equal(result.company.sales.foton, 15); assert.equal(result.company.sales.dongfeng, 14);
  assert.equal(result.company.weekly_sales.company, 15); assert.equal(result.company.ufis.company, 14);
  assert.equal(result.company.other_credits.dongfeng, 14);
  for (const id of f.ids) {
    const store = result.stores[id];
    assert.equal(Object.keys(store).length, 7);
    assert.equal(store.sales.company, id === '15' ? 0 : id === '1' ? 3 : 2);
    assert.equal(store.sales.foton, id === '15' ? 0 : 1);
    assert.equal(store.sales.dongfeng, id === '15' ? 0 : 1);
    assert.equal(store.ufis.foton, ['2', '15'].includes(id) ? 0 : 1);
    assert.equal(store.weekly_sales.dongfeng, 0);
    for (const metric of ['quotations', 'approved', 'precurse']) {
      assert.equal(result.company[metric].company, 6);
      assert.equal(result.company[metric].foton, 2); assert.equal(result.company[metric].dongfeng, 3);
      assert.equal(store[metric].company, id === '1' ? 3 : id === '2' ? 1 : 0);
      assert.equal(store[metric].foton, id === '1' ? 1 : 0);
      assert.ok(store[metric].evidence_ids.length);
    }
  }
  assert.equal(Object.values(result.stores).reduce((sum, store) => sum + store.sales.company, 0), 29);
  assert.equal(result.company.sales.company, 30, 'unresolved store remains in company, never reassigned');
});

test('grouped refresh rejects missing coverage, mismatched P1 groups and inconsistent snapshots', async () => {
  for (const hook of ['truncate', 'uncertified', 'stale']) {
    const f = groupedFixture(); f.hooks[hook] = true;
    await assert.rejects(f.get(), /P1_SALES_WORK_PARITY_FAILED|Incomplete P1 grouped evidence|P1_PRECURSE_SNAPSHOT_MISMATCH/);
  }
  for (const field of ['brandEvidence', 'financeEvidence']) {
    const f = groupedFixture(); f[field].payload.members[0].value++;
    await assert.rejects(f.get(), /P1_SALES_GROUP_PARITY_FAILED/);
  }
});
