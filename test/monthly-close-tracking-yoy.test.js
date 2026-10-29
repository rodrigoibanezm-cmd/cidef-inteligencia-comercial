import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyCloseTrackingYoy } from '../lib/monthly-close-tracking-yoy.js';

const input = { run_id: 'yoy-test', period: '2026-10', cutoff_date: '2026-10-29', store_ids: ['8', '22'] };
const samples = { COMPANY: [10, 15, 5, 0.5, 'INCREASE'], DEALERS: [4, 2, -2, -0.5, 'DECREASE'],
  '8': [0, 3, 3, null, 'INCREASE'], '22': [2, 2, 0, 0, 'UNCHANGED'] };
function fixture({ period = input.period, mutate = () => {}, shiftStart = false } = {}) {
  const calls = [], originals = new Map();
  const load = createMonthlyCloseTrackingYoy({ withP1Mcp: async callback => callback('mock-client'),
    callP1: async (client, name, args) => {
      assert.equal(client, 'mock-client'); calls.push({ name, args });
      if (name === 'data_observe') {
        const f = args.filters, shape = args.evidence_shape;
        const e = { evidence_id: 'p1-original-' + calls.length, evidence_version: '0.1.0',
          evidence_contract: 'p1.' + shape.toLowerCase(), source: 'SALES', authority: 'P1_CERTIFIED', status: 'CERTIFIED',
          measure: { id: 'VIN_SALES', unit: 'VIN', aggregation: 'COUNT_RECOGNIZED_SALE' }, lineage: { certifier: 'salesCertifier' } };
        if (shape === 'PERIOD_CALENDAR') {
          const [y, m] = args.period.split('-').map(Number), end = new Date(Date.UTC(y, m, 0)).getUTCDate();
          const days = Array.from({ length: end }, (_, i) => new Date(Date.UTC(y, m - 1, i + 1 + Number(shiftStart))).toISOString().slice(0, 10));
          Object.assign(e, { temporal: { period_identity: args.period, period_type: 'COMMERCIAL_MONTH', close_boundary: days.at(-1) },
            payload: { eligible_observation_days: days, close_boundary: days.at(-1) }, coverage: { eligible_days: days.length } });
        } else {
          assert.equal(shape, 'QUANTITATIVE_OBSERVATION');
          const sample = samples[f.store_id || f.commercial_universe], current = f.date_from.slice(0, 4) === period.slice(0, 4);
          Object.assign(e, { grain: 'FILTERED_SALES_UNIVERSE', universe: { commercial_universe: f.commercial_universe },
            dimensions: f.store_id ? { store_id: f.store_id } : {}, payload: { value: sample[Number(current)] },
            temporal: { date_from: f.date_from, date_to: f.date_to, date_semantics: 'fecha_factura' },
            coverage: { source_n: 100, filtered_n: sample[Number(current)] } });
        }
        mutate(e, name, args); originals.set(e.evidence_id, e); return e;
      }
      assert.equal(name, 'p2_execute');
      const baseline = originals.get(args.evidence.baseline), comparison = originals.get(args.evidence.comparison);
      const s = samples[baseline.dimensions.store_id || baseline.universe.commercial_universe];
      const p2 = { status: 'EXECUTED', result: { baseline_value: s[0], comparison_value: s[1], absolute_delta: s[2],
        relative_delta: s[3], relative_delta_status: s[0] === 0 ? 'ZERO_BASELINE' : 'CALCULATED', direction: s[4] },
        lineage: { unit_id: args.unit_id, contract_version: args.contract_version, run_id: args.run_id, execution_id: 'exec-' + calls.length,
          evidence_refs: [{ slot: 'baseline', evidence_id: baseline.evidence_id }, { slot: 'comparison', evidence_id: comparison.evidence_id }] } };
      mutate(p2, name, args); return p2;
    } });
  return { load, calls, originals };
}

test('returns P2 YoY for COMPANY, DEALERS and each STORE without mixing universes', async () => {
  const result = await fixture().load(input);
  assert.deepEqual(result.rows.map(r => [r.dimension, r.dimension_id, r.payload.yoy.absolute_delta, r.payload.yoy.percentage_delta]),
    [['COMPANY', 'ALL', 5, 50], ['DEALERS', 'ALL', -2, -50], ['STORE', '8', 3, null], ['STORE', '22', 0, 0]]);
  assert.deepEqual(result.rows.map(r => r.payload.yoy.commercial_universe), ['COMPANY', 'DEALERS', 'OWN_STORES', 'OWN_STORES']);
});

test('passes original scalar evidence ids to P2 in the same run and filters each store individually', async () => {
  const { load, calls, originals } = fixture(), result = await load(input);
  const scalars = calls.filter(c => c.args.filters), p2 = calls.filter(c => c.name === 'p2_execute');
  assert.equal(scalars.length, 8); assert.equal(p2.length, 4);
  assert.deepEqual(scalars.map(c => c.args.filters.store_id).filter(Boolean), ['8', '8', '22', '22']);
  assert.ok(scalars.every(c => c.args.period === undefined));
  assert.ok(calls.every(c => c.args.run_id === input.run_id));
  for (const c of p2) for (const ref of Object.values(c.args.evidence)) {
    assert.equal(typeof ref, 'string'); assert.ok(result.evidence.includes(originals.get(ref)));
    assert.equal(originals.get(ref).evidence_contract, 'p1.quantitative_observation');
  }
});

test('aligns certified commercial-day positions and rejects missing or open/full mismatched cuts', async () => {
  const { load, calls } = fixture({ shiftStart: true }), result = await load(input);
  const yoy = result.rows[0].payload.yoy;
  assert.equal(yoy.baseline.date_from, '2025-10-02'); assert.equal(yoy.baseline.cutoff_date, '2025-10-29');
  assert.equal(yoy.comparison.date_from, '2026-10-02');
  assert.ok(calls.filter(c => c.args.filters).every(c => c.args.filters.date_to.endsWith('-29')));
  for (const [period, cutoff_date] of [['2028-02', '2028-02-29'], ['2025-02', '2025-02-28']]) {
    await assert.rejects(fixture({ period }).load({ ...input, period, cutoff_date }), /NO_EQUIVALENT_YOY_CUTOFF/);
  }
});

test('keeps P2 ZERO_BASELINE with null relative and percentage variation', async () => {
  const row = (await fixture().load(input)).rows.find(r => r.dimension_id === '8').payload.yoy;
  assert.equal(row.baseline_value, 0); assert.equal(row.absolute_delta, 3);
  assert.equal(row.relative_delta_status, 'ZERO_BASELINE'); assert.equal(row.relative_delta, null); assert.equal(row.percentage_delta, null);
});

test('rejects incomplete or incompatible P1 and invalid P2 evidence/results', async () => {
  for (const change of [e => { delete e.evidence_id; }, e => { delete e.lineage; }, e => { e.status = 'PARTIAL'; },
    e => { e.universe.commercial_universe = 'WRONG'; }, e => { e.dimensions = { store_id: '99' }; },
    e => { e.temporal.date_to = '2026-10-31'; }, e => { e.coverage.filtered_n++; },
    e => { e.payload = { members: [] }; }, e => { e.evidence_contract = 'p1.dimensional_quantitative_dataset'; }]) {
    await assert.rejects(fixture({ mutate: (e, name, args) => { if (args.filters) change(e); } }).load(input), /YOY_P1/);
  }
  await assert.rejects(fixture({ mutate: (e, name) => { if (name === 'p2_execute') e.lineage.evidence_refs = []; } }).load(input), /INVALID_YOY_P2_RESULT/);
});
