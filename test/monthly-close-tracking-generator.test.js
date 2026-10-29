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
      const token = createHash('sha256').update(JSON.stringify(canonical({ name, args }))).digest('hex');
      active++; maximum = Math.max(maximum, active);
      try {
      // Yield while the request is outstanding: a sequential implementation cannot pass the overlap test.
      await new Promise(resolve => setImmediate(resolve));
      if (name === 'p2_execute') {
        const pair = args.unit_id === 'p2.observed_pair_delta';
        const a = originals.get(args.evidence[pair ? 'baseline' : 'observed']);
        const b = originals.get(args.evidence[pair ? 'comparison' : 'reference']);
        assert.ok(a && b);
        if (options.failRhythm && a.temporal.period_identity === '2026-09') throw new Error('RHYTHM_P2_FAILURE');
        const v = pair ? a.payload.value : a.payload.observed_value, ref = b.payload.value;
        const result = pair ? { baseline_value: v, comparison_value: ref, absolute_delta: ref - v,
          relative_delta: v ? (ref - v) / v : null, relative_delta_status: v ? 'CALCULATED' : 'ZERO_BASELINE',
          direction: ref > v ? 'INCREASE' : ref < v ? 'DECREASE' : 'UNCHANGED' } : {
          observed_value: v, reference_value: ref, absolute_deviation: v - ref,
          relative_deviation: ref ? (v - ref) / ref : null, relative_deviation_status: ref ? 'CALCULATED' : 'ZERO_REFERENCE',
          direction: v > ref ? 'ABOVE_REFERENCE' : v < ref ? 'BELOW_REFERENCE' : 'ON_REFERENCE' };
        return { status: 'EXECUTED', result, lineage: { run_id: args.run_id, execution_id: 'exec-' + token,
          unit_id: args.unit_id, contract_version: args.contract_version,
          evidence_refs: Object.entries(args.evidence).map(([slot, evidence_id]) => ({ slot, evidence_id })) } };
      }
      assert.equal(name, 'data_observe');
      const p = args.period || args.filters.date_from.slice(0, 7), id = args.filters?.store_id;
      if (options.failYoy && p === '2025-10') throw new Error('MISSING_YOY_EVIDENCE');
      const e = { source: args.source, authority: 'P1_CERTIFIED', status: 'CERTIFIED', evidence_id: 'original-' + token,
        evidence_version: '0.1.0', lineage: { certifier: args.source }, evidence_contract: 'p1.' + args.evidence_shape.toLowerCase() };
      const [year, month] = p.split('-').map(Number), first = p + '-01';
      if (args.evidence_shape === 'PERIOD_CALENDAR') {
        const days = Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, i) => p + '-' + String(i + 1).padStart(2, '0'));
        Object.assign(e, { measure: { id: 'VIN_SALES', unit: 'VIN' }, temporal: { period_identity: p, period_type: 'COMMERCIAL_MONTH', close_boundary: days.at(-1) },
          coverage: { eligible_days: days.length }, payload: { eligible_observation_days: days, close_boundary: days.at(-1) } });
      } else if (args.source === 'TARGETS') {
        if (options.noTarget && p === input.period) throw new Error('TARGET_REFERENCE_NOT_FOUND');
        Object.assign(e, { grain: 'STORE_MONTH', measure: { id: 'VIN_TARGET', unit: 'VIN', aggregation: 'EXPLICIT_TARGET' },
          universe: { commercial_universe: 'OWN_STORES' }, dimensions: { store_id: id }, temporal: { period_identity: p },
          coverage: { complete: true, rows: 1 }, payload: { value: options.zeroTarget ? 0 : 100, reference_type: 'OFFICIAL_TARGET', source: 'official' } });
      } else {
        const grouped = args.evidence_shape === 'DIMENSIONAL_QUANTITATIVE_DATASET';
        const cumulative = args.evidence_shape === 'CUMULATIVE_PERIOD_OBSERVATION';
        const universe = args.filters.commercial_universe;
        const value = universe === 'COMPANY' ? 100 : universe === 'DEALERS' ? 40 : id ? 30 : 60;
        const from = args.filters.date_from || first, to = args.filters.date_to || args.cutoff;
        Object.assign(e, { grain: 'FILTERED_SALES_UNIVERSE', measure: { id: 'VIN_SALES', unit: 'VIN', aggregation: 'COUNT_RECOGNIZED_SALE' },
          universe: { commercial_universe: universe }, dimensions: id ? { store_id: id } : {},
          temporal: { date_from: from, date_to: to, date_semantics: 'fecha_factura', ...(cumulative ? {
            period_identity: p, period_type: 'COMMERCIAL_MONTH', cutoff: args.cutoff } : {}) },
          coverage: { source_n: 200, filtered_n: value }, payload: cumulative ? { observed_value: value + (options.mismatch && p === input.period ? 1 : 0) } : { value } });
        if (options.mismatch && cumulative && p === input.period) e.coverage.filtered_n++;
        if (grouped) {
          e.payload = { dimension: { id: 'STORE' }, members: ['8', '22'].map(member_id => ({ member_id, value: 30 })) };
          Object.assign(e.coverage, { dimension_resolved_n: 60, dimension_unresolved_n: 0 });
        }
      }
      originals.set(e.evidence_id, e); return e;
      } finally { active--; }
    },
  };
  const generate = createMonthlyCloseTrackingGenerator(deps);
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
  for (const c of f.calls.filter(c => c.name === 'p2_execute')) {
    for (const id of Object.values(c.args.evidence)) assert.ok(s.sources.evidence.includes(f.originals.get(id)));
  }
  // Current cumulative STORE observations and target/P2 calls are reused, never reconstructed.
  assert.equal(f.calls.filter(c => c.args.evidence_shape === 'CUMULATIVE_PERIOD_OBSERVATION' && c.args.period === input.period).length, 4);
  assert.equal(f.calls.filter(c => c.args.source === 'TARGETS' && c.args.period === input.period).length, 2);
  assert.equal(f.calls.filter(c => c.name === 'p2_execute' && c.args.unit_id === 'p2.reference_deviation').length, 12);
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

test('does not publish incompatible current observations or incomplete YoY evidence', async () => {
  for (const [options, error] of [[{ mismatch: true }, /INCONSISTENT_CURRENT_EVIDENCE/], [{ failYoy: true }, /MISSING_YOY_EVIDENCE/]]) {
    const f = fixture(options); await assert.rejects(f.generate(input), error);
    assert.equal(f.publications.length, 0); assert.equal(f.writes.length, 0); assert.deepEqual(f.connectionCounts(), [1, 1]);
  }
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
  const yoy = await createMonthlyCloseTrackingYoy(deps)(common);
  const rhythm = await createMonthlyCloseTrackingRhythm(deps)(common);
  const observed = [];
  for (const member of sales.expected_members) observed.push({ ...member, evidence: await deps.callP1('mock', 'data_observe', {
    run_id: input.run_id, source: 'SALES', measure: 'VIN_SALES', evidence_shape: 'CUMULATIVE_PERIOD_OBSERVATION',
    period: input.period, cutoff: input.cutoff_date, filters: { commercial_universe: member.dimension === 'STORE' ? 'OWN_STORES' : member.dimension,
      ...(member.dimension === 'STORE' ? { store_id: member.dimension_id } : {}) },
  }) });
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
    await assert.rejects(f.generate(input), /MISSING_YOY_EVIDENCE|RHYTHM_P2_FAILURE/);
    assert.equal(f.publications.length, 0); assert.equal(f.writes.length, 0);
    assert.equal(f.concurrency().active, 0); assert.ok(f.concurrency().maximum <= 2);
    assert.deepEqual(f.connectionCounts(), [1, 1]);
    const completed = f.calls.length; await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, completed);
  }
});
