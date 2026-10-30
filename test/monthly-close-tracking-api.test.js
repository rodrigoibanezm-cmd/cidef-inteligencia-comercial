import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const source = await readFile(new URL('../app/api/monthly-close-tracking/route.js', import.meta.url), 'utf8');
const body = { period: '2026-10', cutoff_date: '2026-10-29', cutoff_at: '2026-10-29T18:00:00-03:00' };
const request = (value = body) => new Request('http://local/api/monthly-close-tracking', {
  method: 'POST', body: JSON.stringify(value), headers: { 'content-type': 'application/json' } });
const get = (query = 'period=2026-10&cutoff_date=2026-10-29') => new Request('http://local/api/monthly-close-tracking?' + query);
const plain = value => JSON.parse(JSON.stringify(value));
async function fixture(options = {}) {
  const calls = { reads: [], generates: [], branches: 0, publishes: 0, queries: [], p1: [] };
  const details = [
    { vin: 'A', sucursal_id: '8', sucursal: 'Plaza Norte', fecha_venta: '2026-10-01' },
    { vin: 'B', sucursal_id: '8', sucursal: 'Plaza Norte', fecha_venta: '2026-10-26' },
    { vin: 'C', sucursal_id: '8', sucursal: 'Plaza Norte', fecha_venta: '2026-10-27' },
    { vin: 'D', sucursal_id: '8', sucursal: 'Plaza Norte', fecha_venta: '2026-10-29' },
  ];
  const work = { source: 'SALES', dataset: 'SALES_WORK', version: '0.13', grain: 'RECOGNIZED_SALE',
    size: { filtered_n: 3 }, rows: [
      { vin: 'E', dealer_group_id: '8', sale_date: '2026-10-20' },
      { vin: 'F', dealer_group_id: '8', sale_date: '2026-10-27' },
      { vin: 'G', dealer_group_id: null, sale_date: '2026-10-29' },
    ] };
  options.mutateWork?.(work);
  const rows = ['COMPANY', 'DEALERS', 'STORE', 'STORE'].map((dimension, i) => ({
    environment: options.environment || 'staging', period: '2026-10-01', cutoff_date: '2026-10-28',
    cutoff_at: '2026-10-28T21:00:00Z', cutoff_timezone: 'America/Santiago', generation_id: 'one-generation',
    generated_at: '2026-10-28T21:01:00Z', engine_version: 'v1', sources: { sales: { evidence_ids: ['p1-original'] } },
    dimension, dimension_id: i < 2 ? 'ALL' : String(i), payload: { sales_mtd: { value: 12 },
      yoy: { absolute_delta: 2 }, attainment: { attainment_percent: i < 2 ? null : 50 }, rhythm: i < 2 ? null : { current: {} } },
  }));
  if (options.mixed) rows[2].generation_id = 'other-generation';
  const store = { latest: async args => { calls.reads.push(plain(args)); return options.empty ? [] : rows; },
    publish: async () => { calls.publishes++; throw new Error('Unexpected direct publication'); } };
  const context = createContext({ URL, Intl, Date, process: { env: { PROJECTIONS_ENVIRONMENT: options.environment || 'staging' } } });
  const exports = {
    'node:crypto': { randomUUID }, 'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '../../../lib/monthly-close-tracking-store.js': { createMonthlyCloseTrackingStore: () => store },
    '../../../lib/monthly-close-tracking-generator.js': { createMonthlyCloseTrackingGenerator: deps => {
      assert.equal(deps.store, store);
      return async args => { calls.generates.push(plain(args));
        if (options.failGeneration) throw new Error('SIMULATED_P1_FAILURE');
        return { publication: { generation_id: 'new-generation', generated_at: '2026-10-29T21:01:00Z', rows: 4 } };
      };
    } },
    '../../../lib/db.js': { db: () => ({ query: async (query, args) => {
      calls.queries.push({ query, args: args && plain(args) });
      if (query.includes('weekly_projection_results')) return options.noProjection ? [] : [{ updated_at: 'saved-cut',
        payload: { admin: { sales_mtd: { date_from: '2026-10-01', cutoff_date: '2026-10-29',
          total_units: options.incompleteProjection ? 5 : 4, details } } } }];
      assert.match(query, /SELECT to_jsonb\(g\) AS item FROM dealer_groups g/);
      return [{ item: { dealer_group_id: 8, nombre_canonico: 'Dealer ocho' } },
        { item: { id: 9, nombre: 'Dealer sin ventas' } }];
    } }) },
    '../../../lib/p1-client.js': { withP1Mcp: async callback => callback('mock-client'),
      callP1: async (client, name, args) => {
        assert.equal(client, 'mock-client'); calls.p1.push({ name, args: plain(args) });
        return { ...work, filters: args.filters };
      } },
    '../weekly-projections/sucursales/route.js': { GET: async () => { calls.branches++;
      return Response.json({ ok: true, sucursales: options.invalidCatalog ? [] : [
        { sucursal_id: 8, nombre_canonico: 'Plaza Norte' }, { sucursal_id: '22', nombre_canonico: 'Costanera' }] });
    } },
  };
  const module = new SourceTextModule(source, { context });
  await module.link(specifier => {
    assert.ok(exports[specifier], 'Unexpected dependency: ' + specifier);
    const values = exports[specifier];
    return new SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, calls, rows, work };
}

test('daily view reuses saved own-store detail and fetches dealers once, without generation', async () => {
  const f = await fixture(), response = await f.api.GET(get('period=2026-10&cutoff_date=2026-10-29&view=daily'));
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.monday_date, '2026-10-26');
  assert.deepEqual(data.stores.map(r => [r.id, r.name, r.monday, r.daily.map(d => d.value), r.total]), [
    ['8', 'Plaza Norte', 2, [1, 0, 1, null, null], 4], ['22', 'Costanera', 0, [0, 0, 0, null, null], 0],
  ]);
  assert.deepEqual(data.dealers.map(r => [r.id, r.name, r.monday, r.daily.map(d => d.value), r.total]), [
    ['8', 'Dealer ocho', 1, [1, 0, 0, null, null], 2], ['9', 'Dealer sin ventas', 0, [0, 0, 0, null, null], 0],
    ['0', 'Sin dealer identificado', 0, [0, 0, 1, null, null], 1],
  ]);
  for (const row of [...data.stores, ...data.dealers])
    assert.equal(row.total, row.monday + row.daily.reduce((n, d) => n + (d.value ?? 0), 0));
  assert.equal(f.calls.queries.length, 2); assert.deepEqual(f.calls.queries[0].args, ['2026-10-26', '2026-10-29', 'staging']);
  assert.ok(f.calls.queries.every(c => /^SELECT /.test(c.query)));
  assert.equal(f.calls.p1.length, 1); assert.equal(f.calls.p1[0].name, 'data_fetch');
  assert.deepEqual(f.calls.p1[0].args.fields, ['vin', 'sale_date', 'dealer_group_id']);
  assert.deepEqual(f.calls.p1[0].args.filters, { commercial_universe: 'DEALERS', date_from: '2026-10-01', date_to: '2026-10-29' });
  assert.equal(f.calls.generates.length, 0); assert.equal(f.calls.publishes, 0); assert.equal(f.calls.reads.length, 0);
});

test('daily view rejects missing cuts, incomplete details and invalid dates without producing false zeros', async () => {
  const query = 'period=2026-10&cutoff_date=2026-10-29&view=daily';
  const missing = await fixture({ noProjection: true });
  const response = await missing.api.GET(get(query));
  assert.equal(response.status, 404); assert.equal((await response.json()).error, 'PROJECTIONS_SNAPSHOT_NOT_FOUND');
  assert.equal(missing.calls.p1.length, 0);
  for (const options of [{ incompleteProjection: true }, { invalidCatalog: true },
    { mutateWork: w => w.rows.pop() }, { mutateWork: w => w.rows[0].sale_date = '2026-10-30' },
    { mutateWork: w => w.rows[0].dealer_group_id = 'invalid' }]) {
    const f = await fixture(options), result = await f.api.GET(get(query));
    assert.equal(result.status, 500); assert.equal((await result.json()).ok, false);
    assert.equal(f.calls.generates.length, 0); assert.equal(f.calls.publishes, 0);
  }
  for (const query of ['period=2026-09&cutoff_date=2026-09-29&view=daily',
    'period=2026-10&cutoff_date=2026-10-25&view=daily', 'period=2026-10&cutoff_date=2026-10-29&view=other']) {
    const f = await fixture(); assert.equal((await f.api.GET(get(query))).status, 400);
    assert.equal(f.calls.queries.length, 0); assert.equal(f.calls.p1.length, 0);
  }
  const prod = await fixture({ environment: 'production' });
  assert.equal((await prod.api.GET(get(query))).status, 403); assert.equal(prod.calls.queries.length, 0);
});

test('GET reads one generation via the store, includes all dimensions and metadata, and never generates', async () => {
  const f = await fixture(), response = await f.api.GET(get()), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.generation_id, 'one-generation');
  assert.equal(data.cutoff_date, '2026-10-28'); assert.equal(data.requested_cutoff_date, '2026-10-29');
  assert.equal(data.rows.length, 4); assert.deepEqual(data.rows.map(r => r.payload), f.rows.map(r => r.payload));
  assert.deepEqual(data.sources, f.rows[0].sources);
  assert.deepEqual(f.calls.reads, [{ environment: 'staging', period: '2026-10-01', cutoff_date: '2026-10-29' }]);
  assert.equal(f.calls.generates.length, 0); assert.equal(f.calls.branches, 0);
  assert.equal((await (await fixture({ empty: true })).api.GET(get())).status, 404);
  assert.equal((await (await fixture({ mixed: true })).api.GET(get())).status, 500);
});

test('POST invokes existing generator with canonical roster and server-owned run/version/environment', async () => {
  const f = await fixture(), response = await f.api.POST(request()), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.generation_id, 'new-generation'); assert.equal(data.rows, 4);
  assert.equal(f.calls.generates.length, 1); const args = f.calls.generates[0];
  assert.deepEqual(args.store_ids, ['8', '22']); assert.equal(args.environment, 'staging');
  assert.equal(args.engine_version, 'monthly-close-tracking-v1'); assert.equal(args.cutoff_timezone, 'America/Santiago');
  for (const [key, value] of Object.entries(body)) assert.equal(args[key], value);
  assert.match(args.run_id, /^[0-9a-f-]{36}$/); assert.equal(f.calls.publishes, 0); assert.equal(f.calls.reads.length, 0);
});

test('invalid query, body, dates and timestamps are rejected before reading sources or generating', async () => {
  const f = await fixture();
  for (const query of ['', 'period=2026-13&cutoff_date=2026-10-29', 'period=2026-10&cutoff_date=2026-02-30',
    'period=2026-10&cutoff_date=2026-10-29&period=2026-09', 'period=2026-10&cutoff_date=2026-10-29&environment=production'])
    assert.equal((await f.api.GET(get(query))).status, 400);
  for (const value of [null, [], {}, { ...body, period: '2026-00' }, { ...body, cutoff_date: '2026-02-30' },
    { ...body, cutoff_at: '2026-10-30T18:00:00Z' }, { ...body, cutoff_at: '2026-10-29T18:00:00' },
    { ...body, environment: 'production' }, { ...body, store_ids: ['99'] }])
    assert.equal((await f.api.POST(request(value))).status, 400);
  assert.equal((await f.api.POST(new Request('http://local', { method: 'POST', body: '{' }))).status, 400);
  assert.equal(f.calls.branches, 0); assert.equal(f.calls.reads.length, 0); assert.equal(f.calls.generates.length, 0);
});

test('production publication is rejected before catalog access or generation', async () => {
  const f = await fixture({ environment: 'production' });
  assert.equal((await f.api.POST(request())).status, 403);
  assert.equal(f.calls.branches, 0); assert.equal(f.calls.generates.length, 0); assert.equal(f.calls.publishes, 0);
});

test('generation failure and unavailable catalog do not publish or replace previous snapshots', async () => {
  const f = await fixture({ failGeneration: true });
  const response = await f.api.POST(request()); assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'SIMULATED_P1_FAILURE'); assert.equal(f.calls.publishes, 0);
  assert.equal((await (await f.api.GET(get())).json()).generation_id, 'one-generation');
  const empty = await fixture({ invalidCatalog: true }); assert.equal((await empty.api.POST(request())).status, 500);
  assert.equal(empty.calls.generates.length, 0); assert.equal(empty.calls.publishes, 0);
});
