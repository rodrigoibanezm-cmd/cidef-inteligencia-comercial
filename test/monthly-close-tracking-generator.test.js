import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMonthlyCloseTrackingGenerator } from '../lib/monthly-close-tracking-generator.js';
import { createMonthlyCloseTrackingStore } from '../lib/monthly-close-tracking-store.js';
import { createMonthlyCloseTrackingSource } from '../lib/monthly-close-tracking-source.js';
import { createMonthlyCloseTrackingYoy } from '../lib/monthly-close-tracking-yoy.js';
import { createMonthlyCloseTrackingRhythm } from '../lib/monthly-close-tracking-rhythm.js';
import { createMonthlyCloseTrackingAttainment } from '../lib/monthly-close-tracking-attainment.js';

const input = { run_id: 'generator-test', period: '2026-10', cutoff_date: '2026-10-29',
  cutoff_at: '2026-10-29T18:00:00-03:00', store_ids: ['8'], engine_version: 'test-v1' };
function fixture(options = {}) {
  const calls = [], originals = new Map(), publications = [], writes = [];
  let connections = 0, closed = 0, active = 0, maximum = 0;
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  // Exercise the real publisher with a simulated transaction; no database connection.
  const publisher = createMonthlyCloseTrackingStore({ withDbTransaction: async callback => callback({ query: async (sql, values) => {
    writes.push({ sql, values });
    return { rows: sql.includes('clock_timestamp') ? [{ generated_at: '2026-10-29T21:01:00Z' }] : [] };
  } }) });
  const deps = {
    withP1Mcp: async callback => { connections++; try { return await callback('mock'); } finally { assert.equal(active, 0); closed++; } },
    store: { publish: async snapshot => { publications.push(snapshot); return publisher.publish(snapshot); } },
    callP1: async (client, name, args) => {
      assert.equal(client, 'mock'); assert.equal(args.run_id, input.run_id); calls.push({ name, args });
      active++; maximum = Math.max(maximum, active);
      try {
        await new Promise(resolve => setImmediate(resolve));
        const period = args.period || args.filters?.date_from.slice(0, 7);
        if (options.failYoy && period === '2025-10') throw new Error('MISSING_YOY_EVIDENCE');
        if (options.failRhythm && period === '2026-09' && args.source === 'TARGETS') throw new Error('RHYTHM_TARGET_FAILURE');
        if (name === 'data_fetch') {
          const n = args.filters.commercial_universe === 'COMPANY' ? 100 : args.filters.commercial_universe === 'DEALERS' ? 40 : 60;
          const rows = Array.from({ length: n }, (_, i) => ({ vin: 'VIN-' + i, sale_date: args.filters.date_to, store_id: i < 30 ? '8' : '22' }));
          return { source: 'SALES', dataset: 'SALES_WORK', version: 'mock', grain: 'RECOGNIZED_SALE', size: { filtered_n: n }, rows };
        }
        // P1 evidence identifies the observation, independently of the batch operation list.
        function observe(source, shape, filters = {}, cutoff) {
          const token = createHash('sha256').update(JSON.stringify(canonical({ source, shape, period, filters, cutoff }))).digest('hex');
          const id = filters.store_id, grouped = shape === 'DIMENSIONAL_QUANTITATIVE_DATASET';
          const cumulative = shape === 'CUMULATIVE_PERIOD_OBSERVATION';
          const e = { source, authority: 'P1_CERTIFIED', status: 'CERTIFIED', evidence_id: 'original-' + token,
            evidence_version: '0.1.0', lineage: { certifier: source }, evidence_contract: 'p1.' + shape.toLowerCase() };
          const [year, month] = period.split('-').map(Number);
          if (shape === 'PERIOD_CALENDAR') {
            const days = Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, i) => period + '-' + String(i + 1).padStart(2, '0'));
            Object.assign(e, { measure: { id: 'VIN_SALES', unit: 'VIN' }, temporal: { period_identity: period, period_type: 'COMMERCIAL_MONTH', close_boundary: days.at(-1) },
              coverage: { eligible_days: days.length }, payload: { eligible_observation_days: days, close_boundary: days.at(-1) } });
          } else if (source === 'TARGETS') {
            if (options.noTarget && period === input.period) throw new Error('TARGET_REFERENCE_NOT_FOUND');
            Object.assign(e, { grain: 'STORE_MONTH', measure: { id: 'VIN_TARGET', unit: 'VIN', aggregation: 'EXPLICIT_TARGET' },
              universe: { commercial_universe: 'OWN_STORES' }, dimensions: { store_id: id }, temporal: { period_identity: period },
              coverage: { complete: true, rows: 1 }, payload: { value: options.zeroTarget ? 0 : 100, reference_type: 'OFFICIAL_TARGET', source: 'official' } });
          } else {
            const universe = filters.commercial_universe;
            const value = universe === 'COMPANY' ? 100 : universe === 'DEALERS' ? 40 : id ? (['8', '22'].includes(id) ? 30 : 0) : 60;
            const observed = value + (options.mismatch && shape === 'QUANTITATIVE_OBSERVATION' && universe === 'COMPANY' && period === input.period ? 1 : 0);
            Object.assign(e, { grain: 'FILTERED_SALES_UNIVERSE', measure: { id: 'VIN_SALES', unit: 'VIN', aggregation: 'COUNT_RECOGNIZED_SALE' },
              universe: { commercial_universe: universe }, dimensions: id ? { store_id: id } : {},
              temporal: { date_from: filters.date_from || period + '-01', date_to: filters.date_to || cutoff, date_semantics: 'fecha_factura',
                ...((cumulative || grouped) ? { period_identity: period, period_type: 'COMMERCIAL_MONTH', cutoff } : {}) },
              coverage: { source_n: 200, filtered_n: observed }, payload: cumulative ? { observed_value: observed } : { value: observed } });
            if (grouped) {
              e.payload = { dimension: { id: 'STORE' }, members: ['8', '22'].map(member_id => ({ member_id, value: 30 })) };
              Object.assign(e.coverage, { dimension_resolved_n: 60, dimension_unresolved_n: 0 });
              if (period === input.period && options.invalidStorePeriod) e.temporal.period_identity = '2026-09';
            }
          }
          originals.set(e.evidence_id, e); return e;
        }
        if (name === 'sales_observe_many') return { source: 'SALES', period, cutoff: args.cutoff, commercial_universe: args.commercial_universe,
          results: args.operations.map(operation => ({ operation, evidence: observe('SALES', operation.kind === 'STORE' ? 'DIMENSIONAL_QUANTITATIVE_DATASET' : 'QUANTITATIVE_OBSERVATION',
            { commercial_universe: args.commercial_universe, date_from: period + '-01', date_to: args.cutoff }, args.cutoff) })) };
        assert.equal(name, 'data_observe');
        return observe(args.source, args.evidence_shape, args.filters, args.cutoff);
      } finally { active--; }
    },
  };
  const generate = (options.create || createMonthlyCloseTrackingGenerator)(deps);
  return { generate, deps, calls, originals, publications, writes, connectionCounts: () => [connections, closed],
    concurrency: () => ({ active, maximum }) };
}

test('integrates real helpers and publisher, with one connection/run and a complete reconciled batch', async () => {
  const f = fixture(), { snapshot: s, publication } = await f.generate(input);
  assert.deepEqual(f.connectionCounts(), [1, 1]); assert.equal(f.publications.length, 1);
  assert.equal(publication.rows, 4); assert.equal(f.writes.filter(w => w.sql.includes('INSERT')).length, 4);
  assert.equal(new Set(f.writes.filter(w => w.sql.includes('INSERT')).map(w => w.values[5])).size, 1);
  assert.deepEqual(s.expected_members.map(r => [r.dimension, r.dimension_id]), [['COMPANY', 'ALL'], ['DEALERS', 'ALL'], ['STORE', '8'], ['STORE', '22']]);
  for (const row of s.rows) {
    assert.ok(row.payload.daily.length === 6); assert.equal(row.payload.yoy.absolute_delta, 0);
    if (row.dimension === 'STORE') {
      assert.ok(Math.abs(row.payload.attainment.attainment_percent - 30) < 1e-9);
      assert.equal(row.payload.rhythm.coverage.comparable_references, 5);
    } else { assert.equal(row.payload.attainment.attainment_percent, null); assert.equal(row.payload.rhythm, null); }
  }
  for (const e of s.sources.evidence) assert.equal(e, f.originals.get(e.evidence_id));
  // All current SALES observations are original TOTALs or the original shared STORE block.
  const scalars = f.calls.filter(c => c.args.evidence_shape === 'CUMULATIVE_PERIOD_OBSERVATION');
  assert.equal(scalars.length, 0);
  assert.equal(f.calls.filter(c => c.args.source === 'TARGETS' && c.args.period === input.period).length, 2);
  assert.equal(f.calls.filter(c => c.name === 'p2_execute').length, 0);
  assert.equal(s.cutoff_at, input.cutoff_at); assert.equal(s.engine_version, input.engine_version);
});

test('preserves explicit missing and zero target coverage in a complete snapshot', async () => {
  for (const options of [{ noTarget: true }, { zeroTarget: true }]) {
    const { snapshot } = await fixture(options).generate(input);
    for (const row of snapshot.rows.filter(r => r.dimension === 'STORE')) {
      assert.equal(row.payload.attainment.attainment_percent, null);
      assert.equal(row.payload.rhythm.coverage.comparable_references, 0);
      assert.equal(row.payload.rhythm.yoy.difference_pp, null);
    }
  }
});

test('reuses original TOTAL and STORE evidence without any cumulative SALES requests', async () => {
  const f = fixture(), { snapshot } = await f.generate(input);
  const current = f.calls.filter(c => c.name === 'sales_observe_many' && c.args.period === input.period);
  assert.equal(f.calls.length, 31); assert.equal(current.length, 3);
  assert.deepEqual(current.map(c => [c.args.commercial_universe, c.args.operations]),
    [['COMPANY', [{ kind: 'TOTAL' }]], ['DEALERS', [{ kind: 'TOTAL' }]],
      ['OWN_STORES', [{ kind: 'TOTAL' }, { kind: 'STORE' }]]]);
  assert.equal(f.calls.filter(c => c.name === 'sales_observe_many' && c.args.period === '2025-10').length, 3);
  assert.equal(f.calls.filter(c => c.args.evidence_shape === 'PERIOD_CALENDAR' && c.args.period === input.period).length, 1);
  for (const row of snapshot.rows) {
    const id = row.payload.yoy.comparison.evidence_id;
    assert.equal(id, row.payload.sales_mtd.evidence_id);
    assert.equal(row.payload.attainment.sales_evidence_id, id);
    assert.ok(snapshot.sources.evidence.includes(f.originals.get(id)));
    if (row.dimension === 'STORE') {
      assert.equal(row.payload.yoy.comparison.member_id, row.dimension_id);
      assert.equal(f.originals.get(id).evidence_contract, 'p1.dimensional_quantitative_dataset');
      assert.equal(row.payload.rhythm.current.sales_evidence_id, id);
      for (const value of [row.payload.attainment, row.payload.rhythm.current])
        assert.deepEqual(value.lineage.evidence_refs[0], { slot: 'observed', evidence_id: id,
          evidence_contract: 'p1.dimensional_quantitative_dataset', member_id: row.dimension_id });
    } else {
      assert.equal(f.originals.get(id).evidence_contract, 'p1.quantitative_observation');
      assert.equal(row.payload.attainment.sales_vin, f.originals.get(id).payload.value);
      assert.equal(row.payload.attainment.target_vin, null); assert.equal(row.payload.attainment.gap_vin, null);
    }
  }
  assert.equal(f.publications.length, 1); assert.equal(snapshot.rows.length, 4);
});

test('does not publish incompatible current observations or incomplete YoY evidence', async () => {
  for (const [options, error] of [[{ mismatch: true }, /INCOMPLETE_OR_INCOMPATIBLE_SALES_P1/], [{ failYoy: true }, /MISSING_YOY_EVIDENCE/],
    [{ invalidStorePeriod: true }, /INCOMPATIBLE_ATTAINMENT_SALES/]]) {
    const f = fixture(options); await assert.rejects(f.generate(input), error);
    assert.equal(f.publications.length, 0); assert.equal(f.writes.length, 0); assert.deepEqual(f.connectionCounts(), [1, 1]);
  }
});

test('keeps a roster store with zero sales from the complete grouping without inventing scalar evidence', async () => {
  const f = fixture(), { snapshot, publication } = await f.generate({ ...input, store_ids: ['8', '9'] });
  const zero = snapshot.rows.find(row => row.dimension === 'STORE' && row.dimension_id === '9').payload;
  assert.equal(publication.rows, 5); assert.equal(snapshot.rows.length, 5);
  assert.equal(zero.sales_mtd.value, 0); assert.equal(zero.yoy.percentage_delta, null);
  assert.equal(zero.attainment.sales_vin, 0); assert.equal(zero.attainment.attainment_percent, 0);
  assert.equal(zero.attainment.gap_vin, -100); assert.equal(zero.rhythm.current.attainment_percent, 0);
  assert.ok(zero.rhythm.previous_4_months.every(p => p.difference_pp === 0));
  assert.equal(zero.attainment.lineage.evidence_refs[0].member_id, '9');
  assert.equal(zero.attainment.sales_evidence_id, zero.sales_mtd.evidence_id);
  assert.ok(!f.calls.some(c => c.args.evidence_shape === 'CUMULATIVE_PERIOD_OBSERVATION' && c.args.filters?.store_id));
});

test('rejects invalid roster and production without publication', async () => {
  const f = fixture(); await assert.rejects(f.generate({ ...input, store_ids: ['8', '8'] }), /INVALID_SALES_SOURCE_INPUT/);
  await assert.rejects(f.generate({ ...input, environment: 'production' }), /STAGING_ONLY/);
  assert.equal(f.publications.length, 0); assert.equal(f.calls.length, 0);
});

test('overlaps exactly two remote requests and preserves sequential helper results and original evidence', async () => {
  const f = fixture(), { snapshot } = await f.generate(input);
  assert.deepEqual(f.concurrency(), { active: 0, maximum: 2 });
  assert.deepEqual(f.connectionCounts(), [1, 1]);
  const reference = fixture(), deps = reference.deps;
  // Reference: execute the unchanged helpers sequentially, with the same simulated source.
  const sales = await createMonthlyCloseTrackingSource(deps)(input);
  const common = { ...input, store_ids: sales.expected_members.filter(r => r.dimension === 'STORE').map(r => r.dimension_id) };
  const yoy = await createMonthlyCloseTrackingYoy(deps)({ ...common, sales });
  const rhythm = await createMonthlyCloseTrackingRhythm(deps)({ ...common, sales });
  const observed = sales.rows.map(({ dimension, dimension_id, payload }) => ({ dimension, dimension_id,
    evidence: sales.evidence.find(e => e.evidence_id === payload.sales_mtd.evidence_id) }));
  const attainment = await createMonthlyCloseTrackingAttainment(deps)({ ...input, sales: observed });
  const key = row => JSON.stringify([row.dimension, row.dimension_id]);
  for (const row of snapshot.rows) assert.deepEqual(row.payload, Object.assign({}, ...[sales, yoy, attainment, rhythm]
    .map(result => result.rows.find(r => key(r) === key(row)).payload)));
  for (const result of [sales, yoy, attainment, rhythm]) for (const e of result.evidence)
    assert.deepEqual(snapshot.sources.evidence.find(original => original.evidence_id === e.evidence_id), e);
  assert.deepEqual(reference.concurrency(), { active: 0, maximum: 1 });
  // Cache also deduplicates requests shared by both active chains.
  assert.equal(f.calls.filter(c => c.args.evidence_shape === 'PERIOD_CALENDAR' && c.args.period === '2025-10').length, 1);
});

test('drains concurrent work and never publishes when either helper fails', async () => {
  for (const options of [{ failYoy: true }, { failRhythm: true }]) {
    const f = fixture(options);
    await assert.rejects(f.generate(input), /MISSING_YOY_EVIDENCE|RHYTHM_TARGET_FAILURE/);
    assert.equal(f.publications.length, 0); assert.equal(f.writes.length, 0);
    assert.equal(f.concurrency().active, 0); assert.ok(f.concurrency().maximum <= 2);
    assert.deepEqual(f.connectionCounts(), [1, 1]);
    const completed = f.calls.length; await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, completed);
  }
});
