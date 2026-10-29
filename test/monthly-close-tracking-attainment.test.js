import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyCloseTrackingAttainment } from '../lib/monthly-close-tracking-attainment.js';

function fixture({ mutateSales = () => {}, mutateTarget = () => {}, mutateP2 = () => {} } = {}) {
  const run_id = 'attainment-test', period = '2026-10', cutoff_date = '2026-10-29', calls = [];
  const samples = { '8': [12, 20, -8, -0.4, 'BELOW_REFERENCE'], '22': [5, 0, 5, null, 'ABOVE_REFERENCE'],
    '11': [0, 10, -10, -1, 'BELOW_REFERENCE'] };
  const sales = [['COMPANY', 'ALL', 25], ['DEALERS', 'ALL', 8], ['STORE', '8', 12],
    ['STORE', '22', 5], ['STORE', '9', 0], ['STORE', '10', 1], ['STORE', '11', 0]].map(([dimension, dimension_id, value]) => {
    const evidence = { source: 'SALES', authority: 'P1_CERTIFIED', status: 'CERTIFIED', evidence_id: `sales-${dimension}-${dimension_id}`,
      evidence_contract: 'p1.cumulative_period_observation', evidence_version: '0.1.0', lineage: { certifier: 'salesCertifier' },
      grain: 'FILTERED_SALES_UNIVERSE', measure: { id: 'VIN_SALES', unit: 'VIN', aggregation: 'COUNT_RECOGNIZED_SALE' },
      universe: { commercial_universe: dimension === 'STORE' ? 'OWN_STORES' : dimension },
      dimensions: dimension === 'STORE' ? { store_id: dimension_id } : {},
      temporal: { period_identity: period, period_type: 'COMMERCIAL_MONTH', cutoff: cutoff_date,
        date_from: '2026-10-01', date_to: cutoff_date, date_semantics: 'fecha_factura' },
      coverage: { source_n: 100, filtered_n: value }, payload: { observed_value: value } };
    mutateSales(evidence); return { dimension, dimension_id, evidence };
  });
  const originals = new Map(sales.map(row => [row.evidence.evidence_id, row.evidence]));
  const load = createMonthlyCloseTrackingAttainment({ withP1Mcp: async callback => callback('mock-client'),
    callP1: async (client, name, args) => {
      assert.equal(client, 'mock-client'); calls.push({ name, args });
      if (name === 'data_observe') {
        assert.equal(args.source, 'TARGETS'); assert.equal(args.measure, 'VIN_TARGET');
        assert.equal(args.evidence_shape, 'REFERENCE_OBSERVATION'); assert.equal(args.period, period);
        const id = args.filters.store_id;
        if (id === '9') throw new Error('Error executing tool data_observe: TARGET_REFERENCE_NOT_FOUND');
        const e = { source: 'TARGETS', authority: id === '10' ? 'UNVERIFIED' : 'P1_CERTIFIED', status: 'CERTIFIED',
          evidence_id: 'target-' + id, evidence_contract: 'p1.reference_observation', evidence_version: '0.1.0',
          lineage: { authority_table: 'ventas_metas_mensuales' }, grain: 'STORE_MONTH',
          measure: { id: 'VIN_TARGET', unit: 'VIN', aggregation: 'EXPLICIT_TARGET' },
          universe: { commercial_universe: 'OWN_STORES' }, dimensions: { store_id: id }, temporal: { period_identity: period },
          coverage: { complete: true, rows: 1 }, payload: { value: samples[id]?.[1] ?? 20, reference_type: 'OFFICIAL_TARGET', source: 'official-plan' } };
        mutateTarget(e); originals.set(e.evidence_id, e); return e;
      }
      assert.equal(name, 'p2_execute'); assert.equal(args.unit_id, 'p2.reference_deviation');
      const observed = originals.get(args.evidence.observed), target = originals.get(args.evidence.reference), s = samples[observed.dimensions.store_id];
      const result = { status: 'EXECUTED', result: { observed_value: s[0], reference_value: s[1], absolute_deviation: s[2],
        relative_deviation: s[3], relative_deviation_status: s[1] === 0 ? 'ZERO_REFERENCE' : 'CALCULATED',
        direction: s[4], reference_type: 'OFFICIAL_TARGET', reference_source: 'official-plan' },
        lineage: { run_id, unit_id: args.unit_id, contract_version: args.contract_version, execution_id: 'p2-' + calls.length,
          evidence_refs: [{ slot: 'observed', evidence_id: observed.evidence_id }, { slot: 'reference', evidence_id: target.evidence_id }] } };
      mutateP2(result); return result;
    } });
  return { load: () => load({ run_id, period, cutoff_date, sales }), calls, originals };
}
const attainment = (result, id) => result.rows.find(row => row.dimension_id === id).payload.attainment;

test('uses original compatible P1 refs and P2 deviations to report attainment and signed gap', async () => {
  const { load, calls, originals } = fixture(), result = await load(), r = attainment(result, '8');
  assert.equal(r.status, 'CALCULATED'); assert.equal(r.target_vin, 20); assert.equal(r.sales_vin, 12);
  assert.ok(Math.abs(r.attainment_percent - 60) < 1e-10); assert.equal(r.gap_vin, -8);
  assert.equal(r.period, '2026-10'); assert.equal(r.cutoff_date, '2026-10-29');
  for (const { args } of calls.filter(c => c.name === 'p2_execute')) {
    assert.equal(args.run_id, result.run_id);
    for (const id of Object.values(args.evidence)) assert.ok(result.evidence.includes(originals.get(id)));
  }
  assert.equal(attainment(result, '11').attainment_percent, 0);
});

test('keeps COMPANY/DEALERS explicitly unsupported without requesting or aggregating their targets', async () => {
  const { load, calls } = fixture(), result = await load();
  for (const row of result.rows.filter(r => r.dimension !== 'STORE')) {
    assert.equal(row.payload.attainment.status, 'UNSUPPORTED_TARGET_SCOPE');
    assert.equal(row.payload.attainment.target_vin, null); assert.equal(row.payload.attainment.attainment_percent, null);
  }
  assert.ok(calls.filter(c => c.name === 'data_observe').every(c => typeof c.args.filters.store_id === 'string'));
  assert.equal(result.coverage.COMPANY, 'UNSUPPORTED_BY_TARGETS_P1'); assert.equal(result.coverage.DEALERS, 'UNSUPPORTED_BY_TARGETS_P1');
});

test('distinguishes missing/uncertified targets, zero target and certified zero sales', async () => {
  const result = await fixture().load();
  for (const [id, status] of [['9', 'TARGET_NOT_FOUND'], ['10', 'UNCERTIFIED_TARGET']]) {
    const r = attainment(result, id); assert.equal(r.status, status); assert.equal(r.target_vin, null);
    assert.equal(r.attainment_percent, null); assert.equal(r.gap_vin, null);
  }
  const zero = attainment(result, '22'); assert.equal(zero.status, 'ZERO_TARGET');
  assert.equal(zero.target_vin, 0); assert.equal(zero.attainment_percent, null); assert.equal(zero.gap_vin, 5);
  assert.equal(attainment(result, '9').sales_vin, 0);
});

test('rejects incompatible periods, universes, identities, grouped sales and incomplete coverage', async () => {
  for (const change of [e => { e.temporal.period_identity = '2026-09'; }, e => { e.universe.commercial_universe = 'DEALERS'; },
    e => { e.dimensions = { store_id: '99' }; }, e => { e.evidence_contract = 'p1.dimensional_quantitative_dataset'; },
    e => { delete e.payload.observed_value; }, e => { e.coverage.filtered_n++; }]) {
    await assert.rejects(fixture({ mutateSales: change }).load(), /INCOMPATIBLE_ATTAINMENT_SALES/);
  }
  for (const change of [e => { e.temporal.period_identity = '2026-09'; }, e => { e.universe.commercial_universe = 'COMPANY'; },
    e => { e.dimensions.store_id = '99'; }, e => { e.coverage.complete = false; }]) {
    await assert.rejects(fixture({ mutateTarget: change }).load(), /INCOMPATIBLE_ATTAINMENT_TARGET/);
  }
  await assert.rejects(fixture({ mutateP2: e => { e.lineage.evidence_refs = []; } }).load(), /INVALID_ATTAINMENT_P2/);
});
