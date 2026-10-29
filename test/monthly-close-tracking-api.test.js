import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { createMonthlyCloseTrackingGenerator } from '../lib/monthly-close-tracking-generator.js';

const source = await readFile(new URL('../app/api/monthly-close-tracking/route.js', import.meta.url), 'utf8');
const body = { period: '2026-10', cutoff_date: '2026-10-29', cutoff_at: '2026-10-29T18:00:00-03:00' };
const request = (value = body) => new Request('http://local/api/monthly-close-tracking', {
  method: 'POST', body: JSON.stringify(value), headers: { 'content-type': 'application/json' } });
const get = (query = 'period=2026-10&cutoff_date=2026-10-29') => new Request('http://local/api/monthly-close-tracking?' + query);
const plain = value => JSON.parse(JSON.stringify(value));
async function fixture(options = {}) {
  const calls = { reads: [], generates: [], branches: 0, publishes: 0 };
  const rows = ['COMPANY', 'DEALERS', 'STORE', 'STORE'].map((dimension, i) => ({
    environment: options.environment || 'staging', period: '2026-10-01', cutoff_date: '2026-10-28',
    cutoff_at: '2026-10-28T21:00:00Z', cutoff_timezone: 'America/Santiago', generation_id: 'one-generation',
    generated_at: '2026-10-28T21:01:00Z', engine_version: 'v1', sources: { sales: { evidence_ids: ['p1-original'] } },
    dimension, dimension_id: i < 2 ? 'ALL' : String(i), payload: { sales_mtd: { value: 12 },
      yoy: { absolute_delta: 2 }, attainment: { attainment_percent: i < 2 ? null : 50 }, rhythm: i < 2 ? null : { current: {} } },
  }));
  if (options.mixed) rows[2].generation_id = 'other-generation';
  const store = { latest: async args => { calls.reads.push(plain(args)); return { rows: options.empty ? [] : rows }; },
    publish: async () => { calls.publishes++; throw new Error('Unexpected direct publication'); } };
  const context = createContext({ URL, Intl, Date, process: { env: { PROJECTIONS_ENVIRONMENT: options.environment || 'staging' } } });
  const exports = {
    'node:crypto': { randomUUID }, 'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '../../../lib/monthly-close-tracking-store.js': { createMonthlyCloseTrackingStore: () => store },
    '../../../lib/monthly-close-tracking-generator.js': { createMonthlyCloseTrackingGenerator: deps => {
      assert.equal(deps.store, store);
      // Failure path executes the actual generator with a failing simulated P1 connection.
      const failing = createMonthlyCloseTrackingGenerator({ store, withP1Mcp: async () => { throw new Error('SIMULATED_P1_FAILURE'); } });
      return async args => { calls.generates.push(plain(args));
        if (options.failGeneration) return failing(args);
        return { publication: { generation_id: 'new-generation', generated_at: '2026-10-29T21:01:00Z', rows: 4 } };
      };
    } },
    '../weekly-projections/sucursales/route.js': { GET: async () => { calls.branches++;
      return Response.json({ ok: true, sucursales: options.invalidCatalog ? [] : [{ sucursal_id: 8 }, { sucursal_id: '22' }] });
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
  return { api: module.namespace, calls, rows };
}

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
