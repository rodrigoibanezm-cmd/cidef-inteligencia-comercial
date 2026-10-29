import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyCloseTrackingYoy } from '../lib/monthly-close-tracking-yoy.js';
import { createMonthlyCloseTrackingSource } from '../lib/monthly-close-tracking-source.js';

const input = { run_id: 'yoy-test', period: '2026-10', cutoff_date: '2026-10-29', store_ids: ['8', '22'] };
const samples = { COMPANY: [10, 15], DEALERS: [4, 2], '8': [0, 3], '22': [2, 2] };
function fixture({ create = createMonthlyCloseTrackingYoy, mutate = () => {}, shiftStart = false } = {}) {
  const calls = [], originals = new Map(); let active = 0, maximum = 0;
  const deps = { withP1Mcp: async callback => callback('mock-client'), callP1: async (client, name, args) => {
    assert.equal(client, 'mock-client'); assert.equal(args.run_id, input.run_id); calls.push({ name, args });
    maximum = Math.max(maximum, ++active); await Promise.resolve(); active--;
    const f = args.filters || {}, month = args.period || f.date_from?.slice(0, 7);
    const universe = args.commercial_universe || f.commercial_universe;
    const current = Number(month?.slice(0, 4) === input.period.slice(0, 4));
    const from = f.date_from || month + (shiftStart ? '-02' : '-01'), to = f.date_to || args.cutoff;
    const observe = kind => {
      const grouped = kind === 'STORE', scalar = kind === 'SCALAR';
      const e = { evidence_id: ['p1-original', month, universe, kind, f.store_id || '', to].join(':'),
        evidence_contract: grouped ? 'p1.dimensional_quantitative_dataset' : 'p1.quantitative_observation',
        source: 'SALES', authority: 'P1_CERTIFIED', status: 'CERTIFIED', evidence_version: '0.1.0',
        grain: 'FILTERED_SALES_UNIVERSE', measure: { id: 'VIN_SALES', unit: 'VIN', aggregation: 'COUNT_RECOGNIZED_SALE' },
        universe: { commercial_universe: universe }, dimensions: f.store_id ? { store_id: f.store_id } : {},
        temporal: { date_from: from, date_to: to, date_semantics: 'fecha_factura' }, lineage: { certifier: 'salesCertifier' },
        payload: grouped ? { dimension: { id: 'STORE' }, members: ['8', '22'].filter(id => samples[id][current]).map(member_id => ({ member_id, value: samples[member_id][current] })) } :
          { value: scalar ? samples[f.store_id || universe][current] : universe === 'OWN_STORES' ? samples['8'][current] + samples['22'][current] : samples[universe][current] } };
      e.coverage = { source_n: 100, filtered_n: grouped ? e.payload.members.reduce((n, m) => n + m.value, 0) : e.payload.value, dimension_unresolved_n: 0 };
      mutate(e, name, args); originals.set(e.evidence_id, e); return e;
    };
    if (name === 'data_observe' && args.evidence_shape === 'PERIOD_CALENDAR') {
      const [y, m] = month.split('-').map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const days = Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, i + 1 + Number(shiftStart))).toISOString().slice(0, 10));
      const e = { evidence_id: 'p1-calendar:' + month, evidence_contract: 'p1.period_calendar', source: 'SALES',
        authority: 'P1_CERTIFIED', status: 'CERTIFIED', evidence_version: '0.1.0', measure: { id: 'VIN_SALES', unit: 'VIN' }, lineage: {},
        temporal: { period_identity: month, period_type: 'COMMERCIAL_MONTH', close_boundary: days.at(-1) },
        payload: { eligible_observation_days: days, close_boundary: days.at(-1) }, coverage: { eligible_days: n } };
      mutate(e, name, args); originals.set(e.evidence_id, e); return e;
    }
    if (name === 'sales_observe_many') return { source: 'SALES', period: month, cutoff: to, commercial_universe: universe,
      results: args.operations.map(operation => ({ operation, evidence: observe(operation.kind) })) };
    if (name === 'data_fetch') {
      const ids = universe === 'OWN_STORES' ? ['8', '22'] : [universe];
      const rows = ids.flatMap(id => Array.from({ length: samples[id][current] }, (_, i) => ({ vin: id + i, sale_date: to, store_id: id })));
      return { source: 'SALES', dataset: 'SALES_WORK', grain: 'RECOGNIZED_SALE', version: '0.13', size: { filtered_n: rows.length }, rows };
    }
    // Legacy paths let the same simulated inputs measure the implementation before this change.
    if (name === 'data_observe') { assert.equal(args.evidence_shape, 'QUANTITATIVE_OBSERVATION'); return observe('SCALAR'); }
    assert.equal(name, 'p2_execute');
    const a = originals.get(args.evidence.baseline).payload.value, b = originals.get(args.evidence.comparison).payload.value;
    return { status: 'EXECUTED', result: { baseline_value: a, comparison_value: b, absolute_delta: b - a,
      relative_delta: a === 0 ? null : (b - a) / a, relative_delta_status: a === 0 ? 'ZERO_BASELINE' : 'CALCULATED', direction: b > a ? 'INCREASE' : b < a ? 'DECREASE' : 'UNCHANGED' },
      lineage: { unit_id: args.unit_id, contract_version: args.contract_version, run_id: args.run_id, execution_id: 'legacy-exec',
        evidence_refs: Object.entries(args.evidence).map(([slot, evidence_id]) => ({ slot, evidence_id })) } };
  } };
  return { load: create(deps), calls, originals, get maximum() { return maximum; },
    prepared: (period = input.period) => createMonthlyCloseTrackingSource(deps)({ ...input, period, cutoff_date: period + '-29' }) };
}

test('uses eight sequential P1 calls and no P2; preserves YoY values, scopes and original block evidence', async () => {
  const f = fixture(), result = await f.load(input);
  assert.equal(f.calls.length, 8); assert.equal(f.maximum, 1);
  assert.equal(f.calls.filter(c => c.name === 'sales_observe_many').length, 6);
  assert.equal(f.calls.filter(c => c.name === 'p2_execute').length, 0);
  assert.deepEqual(result.rows.map(r => [r.dimension, r.dimension_id, r.payload.yoy.absolute_delta, r.payload.yoy.percentage_delta]),
    [['COMPANY', 'ALL', 5, 50], ['DEALERS', 'ALL', -2, -50], ['STORE', '8', 3, null], ['STORE', '22', 0, 0]]);
  assert.deepEqual(result.rows.map(r => r.payload.yoy.commercial_universe), ['COMPANY', 'DEALERS', 'OWN_STORES', 'OWN_STORES']);
  for (const e of result.evidence) assert.equal(e, f.originals.get(e.evidence_id));
  const stores = result.rows.filter(r => r.dimension === 'STORE');
  assert.equal(stores[0].payload.yoy.comparison.evidence_id, stores[1].payload.yoy.comparison.evidence_id);
  assert.equal(stores[0].payload.yoy.comparison.member_id, '8');
  assert.equal(stores[0].payload.yoy.comparison.evidence_contract, 'p1.dimensional_quantitative_dataset');
  assert.equal(result.sources.yoy.calculation, 'LOCAL_YOY'); assert.equal(result.sources.yoy.p2_unit, undefined);
  for (const row of result.rows) { assert.equal(row.payload.yoy.lineage.calculation, 'LOCAL_YOY'); assert.equal(row.payload.yoy.lineage.execution_id, undefined); }
});

test('reuses actual source-helper output: four calls with current sales, zero with both periods', async () => {
  const f = fixture(), current = await f.prepared(), baseline = await f.prepared('2025-10');
  f.calls.length = 0; const first = await f.load({ ...input, sales: current });
  assert.equal(f.calls.length, 4); assert.ok(f.calls.every(c => c.args.period === '2025-10'));
  f.calls.length = 0; const second = await f.load({ ...input, sales: [current, baseline] });
  assert.equal(f.calls.length, 0); assert.deepEqual(second, first);
  for (const e of second.evidence) assert.ok([...current.evidence, ...baseline.evidence].includes(e));
  assert.deepEqual(second.rows, (await fixture().load(input)).rows);
  const partial = { ...current, evidence: current.evidence.filter(e => e.universe?.commercial_universe !== 'DEALERS') };
  f.calls.length = 0; await f.load({ ...input, sales: [partial, baseline] });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].args.commercial_universe, 'DEALERS');
});

test('keeps commercial-day alignment and rejects unavailable or open/full mismatched cuts', async () => {
  const f = fixture({ shiftStart: true }), result = await f.load(input);
  assert.equal(result.rows[0].payload.yoy.baseline.date_from, '2025-10-02');
  assert.equal(result.rows[0].payload.yoy.baseline.cutoff_date, '2025-10-29');
  assert.ok(f.calls.filter(c => c.name === 'sales_observe_many').every(c => c.args.cutoff.endsWith('-29')));
  for (const [period, cutoff_date] of [['2028-02', '2028-02-29'], ['2025-02', '2025-02-28']])
    await assert.rejects(fixture().load({ ...input, period, cutoff_date }), /NO_EQUIVALENT_YOY_CUTOFF/);
  await assert.rejects(fixture().load({ ...input, cutoff_date: '2026-10-32' }), /INVALID_YOY_INPUT/);
});

test('zero historical sales leave percentage null; an absent member in a complete grouping is observed zero', async () => {
  const result = await fixture().load({ ...input, store_ids: [...input.store_ids, '9'] });
  const zero = result.rows.find(r => r.dimension_id === '8').payload.yoy;
  assert.equal(zero.baseline_value, 0); assert.equal(zero.absolute_delta, 3);
  assert.equal(zero.relative_delta_status, 'ZERO_BASELINE'); assert.equal(zero.percentage_delta, null);
  const absent = result.rows.find(r => r.dimension_id === '9').payload.yoy;
  assert.equal(absent.comparison_value, 0); assert.equal(absent.relative_delta, null);
});

test('rejects missing/incompatible blocks and prepared periods without recertifying P1 authority', async () => {
  for (const change of [e => { delete e.evidence_id; }, e => { e.universe.commercial_universe = 'WRONG'; },
    e => { e.temporal.date_to = '2026-10-31'; }, e => { e.dimensions = { store_id: '99' }; }, e => { e.payload = {}; },
    e => { if (e.payload.members) e.coverage.dimension_unresolved_n = 1; },
    e => { if (e.payload.members) e.payload.members.push(e.payload.members[0]); }])
    await assert.rejects(fixture({ mutate: (e, name) => { if (name === 'sales_observe_many') change(e); } }).load(input), /YOY_P1/);
  const f = fixture(), current = await f.prepared();
  for (const sales of [{ ...current, run_id: 'other' }, { ...current, cutoff_date: '2026-10-28' }, { ...current, period: '2026-09-01' }])
    await assert.rejects(f.load({ ...input, sales }), /INCOMPATIBLE_YOY_PREPARED_SALES/);
  const trusted = fixture({ mutate: e => { delete e.authority; delete e.status; delete e.lineage; } });
  assert.equal((await trusted.load(input)).rows.length, 4);
});
