import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyCloseTrackingAttainment } from '../lib/monthly-close-tracking-attainment.js';

function fixture({ create = createMonthlyCloseTrackingAttainment, mutateSales = () => {}, mutateTarget = () => {} } = {}) {
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
  const load = create({ withP1Mcp: async callback => callback('mock-client'),
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
      // Legacy mock retained to measure before/after with exactly the same P1 inputs.
      assert.equal(name, 'p2_execute'); assert.equal(args.unit_id, 'p2.reference_deviation');
      const observed = originals.get(args.evidence.observed), target = originals.get(args.evidence.reference), s = samples[observed.dimensions.store_id];
      const result = { status: 'EXECUTED', result: { observed_value: s[0], reference_value: s[1], absolute_deviation: s[2],
        relative_deviation: s[3], relative_deviation_status: s[1] === 0 ? 'ZERO_REFERENCE' : 'CALCULATED',
        direction: s[4], reference_type: 'OFFICIAL_TARGET', reference_source: 'official-plan' },
        lineage: { run_id, unit_id: args.unit_id, contract_version: args.contract_version, execution_id: 'p2-' + calls.length,
          evidence_refs: [{ slot: 'observed', evidence_id: observed.evidence_id }, { slot: 'reference', evidence_id: target.evidence_id }] } };
      return result;
    } });
  const input = { run_id, period, cutoff_date, sales };
  return { load: (overrides = {}) => load({ ...input, ...overrides }), calls, originals, input };
}
const attainment = (result, id) => result.rows.find(row => row.dimension_id === id).payload.attainment;
function groupedSales(f, mutate = () => {}) {
  const stores = f.input.sales.filter(row => row.dimension === 'STORE');
  const block = { ...stores[0].evidence, evidence_id: 'original-p1-store-block',
    evidence_contract: 'p1.dimensional_quantitative_dataset', dimensions: {},
    coverage: { filtered_n: 18, dimension_unresolved_n: 0 },
    payload: { dimension: { id: 'STORE' }, members: stores.filter(row => row.evidence.payload.observed_value > 0)
      .map(row => ({ member_id: row.dimension_id, value: row.evidence.payload.observed_value })) } };
  mutate(block); f.originals.set(block.evidence_id, block);
  return { block, sales: f.input.sales.map(row => row.dimension === 'STORE' ? { ...row, evidence: block } : row) };
}
function totalSales(f, mutate = () => {}) {
  return f.input.sales.map(row => {
    if (row.dimension === 'STORE') return row;
    // Simulate the original TOTAL contract: no period_identity, period_type or cutoff fields.
    const e = row.evidence, evidence = { ...e, evidence_id: 'original-total-' + row.dimension,
      evidence_contract: 'p1.quantitative_observation', payload: { value: e.payload.observed_value },
      temporal: { date_from: e.temporal.date_from, date_to: e.temporal.date_to, date_semantics: 'fecha_factura' } };
    mutate(evidence); f.originals.set(evidence.evidence_id, evidence);
    return { ...row, evidence };
  });
}

test('calculates locally with five TARGETS P1 calls, one per store including missing targets, and no P2', async () => {
  const { load, calls, originals } = fixture(), result = await load(), r = attainment(result, '8');
  assert.equal(r.status, 'CALCULATED'); assert.equal(r.target_vin, 20); assert.equal(r.sales_vin, 12);
  assert.ok(Math.abs(r.attainment_percent - 60) < 1e-10); assert.equal(r.gap_vin, -8);
  assert.equal(r.period, '2026-10'); assert.equal(r.cutoff_date, '2026-10-29');
  assert.equal(calls.length, 5); assert.ok(calls.every(c => c.name === 'data_observe' && c.args.source === 'TARGETS'));
  assert.deepEqual(calls.map(c => [c.args.filters.store_id, c.args.period]),
    [['8', '2026-10'], ['22', '2026-10'], ['9', '2026-10'], ['10', '2026-10'], ['11', '2026-10']]);
  assert.ok(calls.every(c => c.args.run_id === result.run_id));
  for (const e of result.evidence) assert.equal(e, originals.get(e.evidence_id));
  assert.equal(r.sales_evidence_id, 'sales-STORE-8'); assert.equal(r.target_evidence_id, 'target-8');
  assert.equal(r.lineage.calculation, 'LOCAL_ATTAINMENT'); assert.equal(r.lineage.run_id, result.run_id);
  assert.deepEqual(r.lineage.evidence_refs, [{ slot: 'observed', evidence_id: r.sales_evidence_id },
    { slot: 'reference', evidence_id: r.target_evidence_id }]);
  assert.equal(r.lineage.execution_id, undefined); assert.equal(r.lineage.unit_id, undefined);
  assert.equal(result.sources.attainment.calculation, 'LOCAL_ATTAINMENT');
  assert.equal(result.sources.attainment.p2_unit, undefined); assert.equal(result.sources.attainment.p2_version, undefined);
  assert.deepEqual(r.deviation, { observed_value: 12, reference_value: 20, absolute_deviation: -8,
    relative_deviation: -0.4, relative_deviation_status: 'CALCULATED', direction: 'BELOW_REFERENCE',
    reference_type: 'OFFICIAL_TARGET', reference_source: 'official-plan' });
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

test('rejects incompatible periods, universes, identities, malformed sales and incomplete targets', async () => {
  for (const change of [e => { e.temporal.period_identity = '2026-09'; }, e => { e.universe.commercial_universe = 'DEALERS'; },
    e => { e.dimensions = { store_id: '99' }; }, e => { e.evidence_contract = 'p1.dimensional_quantitative_dataset'; },
    e => { delete e.payload.observed_value; }, e => { e.payload.observed_value = null; },
    e => { delete e.evidence_id; }, e => { e.measure.unit = 'CLP'; }, e => { e.temporal.cutoff = '2026-10-28'; }]) {
    await assert.rejects(fixture({ mutateSales: change }).load(), /INCOMPATIBLE_ATTAINMENT_SALES/);
  }
  for (const change of [e => { e.temporal.period_identity = '2026-09'; }, e => { e.universe.commercial_universe = 'COMPANY'; },
    e => { e.dimensions.store_id = '99'; }, e => { e.coverage.complete = false; }, e => { delete e.evidence_id; },
    e => { e.payload.reference_type = 'ESTIMATED'; }, e => { e.payload.value = null; }, e => { e.payload.value = -1; }]) {
    await assert.rejects(fixture({ mutateTarget: change }).load(), /INCOMPATIBLE_ATTAINMENT_TARGET/);
  }
  const f = fixture();
  await assert.rejects(f.load({ sales: [...f.input.sales, f.input.sales[2]] }), /INCOMPATIBLE_ATTAINMENT_SALES/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(fixture({ mutateTarget: () => { throw new Error('TARGETS_UNAVAILABLE'); } }).load(), /TARGETS_UNAVAILABLE/);
});

test('uses P1 values without repeating authority, lineage or coverage certification on supplied sales', async () => {
  const result = await fixture({ mutateSales: e => {
    delete e.authority; delete e.status; delete e.lineage; delete e.evidence_version; delete e.coverage;
  }, mutateTarget: e => { delete e.lineage; delete e.evidence_version; } }).load();
  assert.equal(attainment(result, '8').attainment_percent, 60);
  assert.equal(attainment(result, '8').gap_vin, -8);
  assert.equal(result.rows.length, 7);
});

test('grouped and individual inputs give identical commercial results with no SALES or P2 queries', async () => {
  const scalar = fixture(), grouped = fixture(), { block, sales } = groupedSales(grouped);
  const before = await scalar.load(), after = await grouped.load({ sales });
  const commercial = result => result.rows.map(row => {
    const { sales_evidence_id, lineage, ...values } = row.payload.attainment;
    return { dimension: row.dimension, dimension_id: row.dimension_id, ...values };
  });
  assert.deepEqual(commercial(after), commercial(before));
  assert.deepEqual(grouped.calls, scalar.calls); assert.equal(grouped.calls.length, 5);
  assert.ok(grouped.calls.every(c => c.name === 'data_observe' && c.args.source === 'TARGETS'));
  assert.equal(attainment(after, '22').status, 'ZERO_TARGET');
  assert.equal(attainment(after, '9').status, 'TARGET_NOT_FOUND');
  assert.equal(attainment(after, '11').attainment_percent, 0);
  for (const row of after.rows.filter(row => row.dimension === 'STORE')) {
    const r = row.payload.attainment;
    assert.equal(r.sales_evidence_id, block.evidence_id);
    if (r.lineage) assert.deepEqual(r.lineage.evidence_refs[0], { slot: 'observed', evidence_id: block.evidence_id,
      evidence_contract: 'p1.dimensional_quantitative_dataset', member_id: row.dimension_id });
  }
  for (const e of after.evidence) assert.equal(e, grouped.originals.get(e.evidence_id));
  assert.ok(after.evidence.includes(block));
  assert.ok(!after.evidence.some(e => e.evidence_id.startsWith('sales-STORE-')));
  assert.equal(block.payload.observed_value, undefined); assert.deepEqual(block.dimensions, {});
});

test('rejects missing or incompatible grouped evidence before querying targets', async () => {
  for (const change of [e => { delete e.evidence_id; }, e => { delete e.payload.members; },
    e => { e.payload.dimension.id = 'SELLER'; }, e => { e.universe = { commercial_universe: 'DEALERS' }; },
    e => { e.temporal = { ...e.temporal, period_identity: '2026-09' }; },
    e => { e.temporal = { ...e.temporal, cutoff: '2026-10-28' }; },
    e => { e.dimensions = { store_id: '8' }; }, e => { e.coverage.dimension_unresolved_n = 1; },
    e => { e.payload.members[0].value = null; }]) {
    const f = fixture(), { sales } = groupedSales(f, change);
    await assert.rejects(f.load({ sales }), /INCOMPATIBLE_ATTAINMENT_SALES/); assert.equal(f.calls.length, 0);
  }
});

test('original COMPANY/DEALERS TOTALs preserve cumulative results and provenance without requesting their targets', async () => {
  const baseline = fixture(), f = fixture(), sales = totalSales(f), saved = JSON.stringify(sales);
  const before = await baseline.load(), after = await f.load({ sales });
  const values = result => result.rows.map(row => {
    const { sales_evidence_id, ...attainment } = row.payload.attainment;
    return { ...row, payload: { attainment } };
  });
  assert.deepEqual(values(after), values(before)); assert.equal(JSON.stringify(sales), saved);
  assert.deepEqual(f.calls, baseline.calls); assert.equal(f.calls.length, 5);
  for (const row of sales.filter(row => row.dimension !== 'STORE')) {
    const result = after.rows.find(r => r.dimension === row.dimension).payload.attainment;
    assert.equal(result.sales_vin, row.evidence.payload.value);
    assert.equal(result.sales_evidence_id, row.evidence.evidence_id);
    assert.equal(result.status, 'UNSUPPORTED_TARGET_SCOPE');
    assert.equal(result.target_vin, null); assert.equal(result.attainment_percent, null); assert.equal(result.gap_vin, null);
    assert.ok(after.evidence.includes(row.evidence));
  }
  assert.ok(f.calls.every(c => c.args.source === 'TARGETS' && c.args.filters.store_id));
  const only = fixture();
  await only.load({ sales: totalSales(only).filter(row => row.dimension !== 'STORE') });
  assert.equal(only.calls.length, 0);
});

test('TOTALs coexist with original STORE groupings, preserving all target states', async () => {
  const f = fixture(), totals = totalSales(f), { block, sales: grouped } = groupedSales(f);
  const result = await f.load({ sales: totals.map(row => row.dimension === 'STORE' ? grouped.find(g => g.dimension_id === row.dimension_id) : row) });
  assert.equal(result.rows.length, 7); assert.equal(f.calls.length, 5);
  for (const [id, status] of [['8', 'CALCULATED'], ['22', 'ZERO_TARGET'], ['9', 'TARGET_NOT_FOUND'], ['10', 'UNCERTIFIED_TARGET']]) {
    assert.equal(attainment(result, id).status, status);
    assert.equal(attainment(result, id).sales_evidence_id, block.evidence_id);
  }
  assert.equal(attainment(result, '8').attainment_percent, 60);
  assert.equal(attainment(result, '11').attainment_percent, 0);
  for (const e of result.evidence) assert.equal(e, f.originals.get(e.evidence_id));
});

test('rejects incompatible TOTAL scopes, dates or values before any remote request', async () => {
  for (const change of [e => { e.universe.commercial_universe = 'OWN_STORES'; },
    e => { e.dimensions = { store_id: '8' }; }, e => { e.temporal.date_from = '2026-09-01'; },
    e => { e.temporal.date_from = '2026-10-15'; }, e => { e.temporal.date_to = '2026-10-28'; },
    e => { e.payload.value = null; }, e => { delete e.evidence_id; }]) {
    const f = fixture(), sales = totalSales(f, change);
    await assert.rejects(f.load({ sales }), /INCOMPATIBLE_ATTAINMENT_SALES/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(), result = await f.load({ sales: totalSales(f, e => { e.payload.value = 0; }) });
  assert.ok(result.rows.filter(r => r.dimension !== 'STORE').every(r => r.payload.attainment.sales_vin === 0));
});
