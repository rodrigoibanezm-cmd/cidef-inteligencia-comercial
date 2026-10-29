import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyCloseTrackingSource } from '../lib/monthly-close-tracking-source.js';

const input = { run_id: 'tracking-test', period: '2026-10', cutoff_date: '2026-10-29', store_ids: ['8', '22', '9'] };
function fixture({ mutate = () => {}, extraStore = false, reviseVin = false } = {}) {
  const calls = [], originals = [], days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const own = [{ vin: 'A', sale_date: '2026-10-26', store_id: '8' }, { vin: 'B', sale_date: '2026-10-29', store_id: '8' },
    { vin: 'C', sale_date: '2026-10-27', store_id: '22' }];
  if (extraStore) own.push({ vin: 'X', sale_date: '2026-10-28', store_id: '44' });
  const dealers = [{ vin: 'D', sale_date: '2026-10-27', store_id: null }, { vin: 'E', sale_date: '2026-10-29', store_id: null },
    { vin: 'F', sale_date: '2026-10-29', store_id: null }];
  const callP1 = async (client, name, args) => {
    assert.equal(client, 'simulated-client'); assert.equal(args.run_id, input.run_id); calls.push({ name, args });
    const universe = args.commercial_universe || args.filters?.commercial_universe;
    const from = args.filters?.date_from || days[0], to = args.filters?.date_to || args.cutoff;
    const all = universe === 'OWN_STORES' ? own : universe === 'DEALERS' ? dealers : [...own, ...dealers];
    const rows = all.filter(row => row.sale_date >= from && row.sale_date <= to);
    const grouped = () => [...new Set(rows.map(row => row.store_id))].map(member_id => ({ member_id,
      value: rows.filter(row => row.store_id === member_id).length }));
    const observation = kind => {
      const e = { evidence_id: 'original-' + universe + '-' + kind + '-' + from + '-' + to,
        source: 'SALES', evidence_version: '0.1.0', authority: 'P1_CERTIFIED', status: 'CERTIFIED',
        evidence_contract: kind === 'STORE' ? 'p1.dimensional_quantitative_dataset' : 'p1.quantitative_observation',
        grain: 'FILTERED_SALES_UNIVERSE', measure: { id: 'VIN_SALES', unit: 'VIN' }, dimensions: {},
        universe: { commercial_universe: universe }, temporal: { date_from: from, date_to: to, date_semantics: 'fecha_factura' },
        coverage: { filtered_n: rows.length, dimension_resolved_n: rows.length, dimension_unresolved_n: 0 },
        payload: kind === 'STORE' ? { dimension: { id: 'STORE' }, members: grouped() } : { value: rows.length } };
      mutate(e, name, args); originals.push(e); return e;
    };
    if (name === 'data_fetch') {
      const result = { source: 'SALES', operation: 'FETCH', dataset: 'SALES_WORK', version: '0.13',
        grain: 'RECOGNIZED_SALE', filters: args.filters, size: { filtered_n: rows.length }, rows: structuredClone(rows) };
      // P1 can revise a recognized VIN's date at the final cutoff; daily presentation uses that date.
      if (reviseVin && result.rows.some(row => row.vin === 'A')) result.rows.find(row => row.vin === 'A').sale_date = '2026-10-29';
      mutate(result, name, args); return result;
    }
    if (name === 'sales_observe_many') return { source: 'SALES', period: args.period, cutoff: to, commercial_universe: universe,
      results: args.operations.map(operation => ({ operation, evidence: observation(operation.kind) })) };
    assert.equal(name, 'data_observe');
    if (args.evidence_shape !== 'PERIOD_CALENDAR') return observation(args.dimension === 'STORE' ? 'STORE' : 'TOTAL');
    const calendar = { evidence_id: 'original-calendar', evidence_version: '0.1.0', authority: 'P1_CERTIFIED', status: 'CERTIFIED', source: 'SALES',
      evidence_contract: 'p1.period_calendar', measure: { id: 'VIN_SALES', unit: 'VIN' }, temporal: { period_identity: args.period, period_type: 'COMMERCIAL_MONTH' },
      payload: { eligible_observation_days: [...days], close_boundary: days.at(-1) }, coverage: { eligible_days: days.length } };
    mutate(calendar, name, args); originals.push(calendar); return calendar;
  };
  const deps = { withP1Mcp: async callback => callback('simulated-client'), callP1 };
  return { load: createMonthlyCloseTrackingSource(deps), calls, originals, deps };
}

test('uses seven sequential calls for all universes, preserving accumulated and daily values', async () => {
  const f = fixture(), result = await f.load(input);
  assert.equal(f.calls.length, 7);
  assert.deepEqual(f.calls.map(c => c.name), ['data_observe', 'sales_observe_many', 'data_fetch', 'sales_observe_many', 'data_fetch', 'sales_observe_many', 'data_fetch']);
  assert.deepEqual(result.rows.map(r => [r.dimension, r.dimension_id, r.payload.sales_mtd.value]),
    [['COMPANY', 'ALL', 6], ['DEALERS', 'ALL', 3], ['STORE', '8', 2], ['STORE', '22', 1], ['STORE', '9', 0]]);
  assert.deepEqual(result.rows[0].payload.daily.map(d => d.value), [1, 2, 0, 3, null, null]);
  assert.deepEqual(result.rows[1].payload.daily.map(d => d.value), [0, 1, 0, 2, null, null]);
  assert.deepEqual(result.rows[2].payload.daily.map(d => d.value), [1, 0, 0, 1, null, null]);
  assert.deepEqual(result.expected_members, result.rows.map(({ dimension, dimension_id }) => ({ dimension, dimension_id })));
  assert.equal(result.own_stores_total, 3); assert.equal(result.sources.sales.daily_basis, 'SALES_WORK_AT_CUTOFF');
  for (const e of result.evidence) assert.ok(f.originals.includes(e));
  for (const row of result.rows) for (const value of [row.payload.sales_mtd, ...row.payload.daily.filter(d => d.status === 'OBSERVED')])
    assert.ok(result.evidence.some(e => e.evidence_id === value.evidence_id));
  assert.equal(result.sources.sales.datasets.length, 3);
  assert.ok(f.calls.filter(c => c.name === 'data_fetch').every(c => c.args.filters.date_to === input.cutoff_date));
});

test('keeps the canonical roster, discovers active stores, and never adds overlapping dimensions', async () => {
  const result = await fixture({ extraStore: true }).load(input);
  assert.deepEqual(result.rows.filter(r => r.dimension === 'STORE').map(r => r.dimension_id), ['8', '22', '9', '44']);
  assert.equal(result.rows[0].payload.sales_mtd.value, 7); assert.equal(result.rows[1].payload.sales_mtd.value, 3);
  assert.equal(result.rows.find(r => r.dimension_id === '44').payload.sales_mtd.value, 1);
  assert.equal(result.rows.find(r => r.dimension_id === '9').payload.daily[2].value, 0);
});

test('uses the certified calendar and leaves future or outside-period days unavailable', async () => {
  const result = await fixture().load({ ...input, cutoff_date: '2026-10-01' });
  assert.equal(result.week_start, '2026-09-28');
  assert.deepEqual(result.rows[0].payload.daily.map(d => d.status), ['OUTSIDE_PERIOD', 'OUTSIDE_PERIOD', 'OUTSIDE_PERIOD', 'OBSERVED', 'AFTER_CUTOFF', 'AFTER_CUTOFF']);
  assert.ok(result.rows[0].payload.daily.filter(d => d.status !== 'OBSERVED').every(d => d.value === null && d.evidence_id === null));
  await assert.rejects(fixture().load({ ...input, cutoff_date: '2026-11-01' }), /INCOMPLETE/);
  await assert.rejects(fixture().load({ ...input, cutoff_date: '2026-10-32' }), /INVALID/);
});

test('daily values follow the final-cutoff P1 facts instead of rebuilding archived daily photos', async () => {
  const result = await fixture({ reviseVin: true }).load(input);
  assert.equal(result.rows[0].payload.sales_mtd.value, 6);
  assert.deepEqual(result.rows[0].payload.daily.map(d => d.value), [0, 2, 0, 4, null, null]);
  assert.deepEqual(result.rows[2].payload.daily.map(d => d.value), [0, 0, 0, 2, null, null]);
});

test('missing, truncated, incompatible or unresolved blocks are not treated as zero', async () => {
  for (const mutate of [
    e => { delete e.evidence_id; },
    (e, name) => { if (name === 'sales_observe_many' && e.payload?.members) e.coverage.dimension_unresolved_n = 1; },
    (e, name) => { if (name === 'sales_observe_many' && e.payload?.members) e.payload.members[0].value++; },
    (e, name) => { if (name === 'data_fetch') e.rows.pop(); },
    (e, name) => { if (name === 'data_fetch' && e.rows.length) e.rows[0].sale_date = '2026-11-01'; },
    (e, name, args) => { if (name === 'data_fetch' && args.filters.commercial_universe === 'OWN_STORES') e.rows[0].store_id = null; },
    (e, name) => { if (name === 'sales_observe_many') e.universe.commercial_universe = 'WRONG'; },
  ]) await assert.rejects(fixture({ mutate }).load(input), /INCOMPLETE/);
});
