import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyCloseTrackingRhythm } from '../lib/monthly-close-tracking-rhythm.js';

const input = { run_id: 'rhythm-test', period: '2026-10', cutoff_date: '2026-10-29', store_ids: ['8', '22'] };
const plan = { '2026-10': [60, 100], '2026-06': [20, 50], '2026-07': [90, 100],
  '2026-08': [30, 100], '2026-09': [60, 200], '2025-10': [50, 100] };
function fixture(options = {}) {
  const calls = [], originals = new Map(); let active = 0, maximum = 0;
  const deps = { withP1Mcp: async callback => callback('mock'),
    callP1: async (client, name, args) => {
      assert.equal(client, 'mock'); assert.equal(args.run_id, input.run_id); calls.push({ name, args });
      maximum = Math.max(maximum, ++active); await Promise.resolve(); active--;
      const grouped = name === 'sales_observe_many', p = args.period, id = args.filters?.store_id;
      assert.ok(grouped || name === 'data_observe');
      if (grouped) {
        assert.equal(args.commercial_universe, 'OWN_STORES'); assert.deepEqual(args.operations, [{ kind: 'STORE' }]);
      }
      const shape = grouped ? 'DIMENSIONAL_QUANTITATIVE_DATASET' : args.evidence_shape;
      const source = grouped ? 'SALES' : args.source;
      const e = { source, authority: 'P1_CERTIFIED', status: 'CERTIFIED',
        evidence_id: ['original', source, shape, p, args.cutoff || '', id || 'ALL'].join(':'),
        evidence_version: '0.1.0', evidence_contract: 'p1.' + shape.toLowerCase(), lineage: { certifier: source } };
      const [year, month] = p.split('-').map(Number), offset = Number(Boolean(options.shiftStart));
      const first = new Date(Date.UTC(year, month - 1, 1 + offset)).toISOString().slice(0, 10);
      const [value, target] = id === '22' ? [10, 20] : plan[p];
      if (shape === 'PERIOD_CALENDAR') {
        if (options.noCalendar === p) throw new Error('NO_CERTIFIED_DATA_IN_PERIOD');
        const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const days = Array.from({ length: n }, (_, i) => new Date(Date.UTC(year, month - 1, i + 1 + offset)).toISOString().slice(0, 10));
        Object.assign(e, { measure: { id: 'VIN_SALES', unit: 'VIN' }, temporal: { period_identity: p, period_type: 'COMMERCIAL_MONTH', close_boundary: days.at(-1) },
          payload: { eligible_observation_days: days, close_boundary: days.at(-1) }, coverage: { eligible_days: n } });
      } else if (source === 'SALES') {
        if (options.noSales === p) return null;
        const observed = options.zeroSales === p ? 0 : value;
        Object.assign(e, { grain: 'FILTERED_SALES_UNIVERSE', measure: { id: 'VIN_SALES', unit: 'VIN', aggregation: 'COUNT_RECOGNIZED_SALE' },
          universe: { commercial_universe: 'OWN_STORES' }, dimensions: grouped ? {} : { store_id: id }, payload: { observed_value: observed },
          temporal: { period_identity: p, period_type: 'COMMERCIAL_MONTH', date_from: first, date_to: args.cutoff, cutoff: args.cutoff, date_semantics: 'fecha_factura' },
          coverage: { source_n: 100, filtered_n: observed } });
        if (grouped) {
          const members = options.zeroSales === p ? [] : input.store_ids.map(member_id => ({ member_id, value: member_id === '22' ? 10 : plan[p][0] }));
          e.payload = { dimension: { id: 'STORE' }, members };
          e.coverage = { source_n: 100, filtered_n: members.reduce((sum, m) => sum + m.value, 0), dimension_unresolved_n: 0 };
        }
      } else {
        assert.equal(source, 'TARGETS');
        if (options.missingTarget === p) throw new Error('TARGET_REFERENCE_NOT_FOUND');
        if (options.uncertifiedTarget === p) e.authority = 'UNVERIFIED';
        Object.assign(e, { grain: 'STORE_MONTH', measure: { id: 'VIN_TARGET', unit: 'VIN', aggregation: 'EXPLICIT_TARGET' },
          universe: { commercial_universe: 'OWN_STORES' }, dimensions: { store_id: id }, temporal: { period_identity: p },
          coverage: { complete: true, rows: 1 }, payload: { value: options.zeroTarget === p ? 0 : target, reference_type: 'OFFICIAL_TARGET', source: 'official-plan' } });
      }
      options.mutate?.(e, name, args); originals.set(e.evidence_id, e);
      return grouped ? { source: 'SALES', period: p, cutoff: args.cutoff, commercial_universe: 'OWN_STORES', results: [{ operation: { kind: 'STORE' }, evidence: e }] } : e;
    } };
  const load = (options.create || createMonthlyCloseTrackingRhythm)(deps);
  // Source-helper metadata and its untouched P1 objects, simulated before invoking Ritmo.
  const prepared = async () => {
    const calendar = await deps.callP1('mock', 'data_observe', { run_id: input.run_id, source: 'SALES', measure: 'VIN_SALES',
      evidence_shape: 'PERIOD_CALENDAR', period: input.period });
    const batch = await deps.callP1('mock', 'sales_observe_many', { run_id: input.run_id, period: input.period,
      cutoff: input.cutoff_date, commercial_universe: 'OWN_STORES', operations: [{ kind: 'STORE' }] });
    return { run_id: input.run_id, period: input.period + '-01', cutoff_date: input.cutoff_date,
      evidence: [calendar, ...batch.results.map(r => r.evidence)] };
  };
  return { load, calls, originals, prepared, get maximum() { return maximum; } };
}
const rhythm = (result, id = '8') => result.rows.find(row => row.dimension === 'STORE' && row.dimension_id === id).payload.rhythm;

test('uses one historical STORE block per period, preserves current scalar ids, and never calls P2', async () => {
  const f = fixture(), result = await f.load(input), r = rhythm(result);
  assert.deepEqual(r.previous_4_months.map(p => p.period), ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(r.yoy.period, '2025-10'); assert.equal(r.coverage.comparable_references, 5);
  assert.equal(f.calls.length, 25); assert.equal(f.maximum, 1);
  const batches = f.calls.filter(c => c.name === 'sales_observe_many');
  assert.deepEqual(batches.map(c => c.args.period), ['2026-06', '2026-07', '2026-08', '2026-09', '2025-10']);
  const scalars = f.calls.filter(c => c.args.evidence_shape === 'CUMULATIVE_PERIOD_OBSERVATION');
  assert.equal(scalars.length, 2); assert.ok(scalars.every(c => c.args.period === input.period));
  assert.equal(r.current.sales_evidence_id, 'original:SALES:CUMULATIVE_PERIOD_OBSERVATION:2026-10:2026-10-29:8');
  for (const e of result.evidence) assert.equal(e, f.originals.get(e.evidence_id));
  assert.equal(r.yoy.sales_evidence_id, rhythm(result, '22').yoy.sales_evidence_id);
  assert.deepEqual(r.yoy.lineage.evidence_refs[0], { slot: 'observed', evidence_id: r.yoy.sales_evidence_id,
    evidence_contract: 'p1.dimensional_quantitative_dataset', member_id: '8' });
  assert.equal(result.sources.rhythm.p2_unit, undefined); assert.equal(result.sources.rhythm.p2_version, undefined);
  assert.equal(result.sources.rhythm.calculation, 'LOCAL_ATTAINMENT_DIFFERENCE_PP');
  assert.ok(!f.calls.some(c => c.name === 'p2_execute'));
  assert.ok(result.rows.filter(row => row.dimension !== 'STORE').every(row => row.payload.rhythm === null));
});

test('aligns by commercial day and excludes shorter or closed historical periods', async () => {
  const { load, calls } = fixture({ shiftStart: true }), result = await load(input);
  assert.equal(result.commercial_day, 28);
  assert.ok(calls.filter(c => c.args.cutoff).every(c => c.args.cutoff.endsWith('-29')));
  assert.equal(rhythm(result).yoy.date_from, '2025-10-02');
  const plain = fixture(), end = rhythm(await plain.load({ ...input, cutoff_date: '2026-10-30' }));
  assert.equal(end.previous_4_months[0].status, 'NO_EQUIVALENT_CUTOFF');
  assert.equal(end.previous_4_months[3].comparison_status, 'EXCLUDED');
  assert.ok(!plain.calls.some(c => c.args.cutoff && ['2026-06', '2026-09'].includes(c.args.period)));
});

test('expresses differences in percentage points, comparing each store independently', async () => {
  const result = await fixture().load(input), r = rhythm(result);
  assert.equal(r.current.attainment_percent, 60);
  assert.deepEqual(r.previous_4_months.map(p => p.difference_pp), [20, -30, 30, 30]);
  assert.equal(r.yoy.difference_pp, 10);
  assert.ok(rhythm(result, '22').previous_4_months.every(p => p.difference_pp === 0));
});

test('excludes missing sales, absent/uncertified/zero targets and unavailable current attainment', async () => {
  const f = fixture({ noSales: '2026-06', missingTarget: '2026-07', zeroTarget: '2026-08', uncertifiedTarget: '2026-09' });
  const r = rhythm(await f.load(input));
  assert.deepEqual(r.previous_4_months.map(p => p.status), ['NO_CERTIFIED_SALES', 'TARGET_NOT_FOUND', 'ZERO_TARGET', 'UNCERTIFIED_TARGET']);
  assert.ok(r.previous_4_months.every(p => p.attainment_percent === null && p.difference_pp === null));
  assert.equal(r.coverage.comparable_references, 1); assert.equal(r.coverage.excluded_references, 4);
  const current = rhythm(await fixture({ zeroTarget: input.period }).load(input));
  assert.equal(current.current.attainment_percent, null); assert.equal(current.coverage.comparable_references, 0);
  assert.equal(current.yoy.difference_pp, null);
  const absent = fixture({ noCalendar: '2026-06' }), result = await absent.load(input);
  assert.equal(rhythm(result).previous_4_months[0].status, 'NO_CERTIFIED_CALENDAR');
  assert.ok(!absent.calls.some(c => c.name === 'sales_observe_many' && c.args.period === '2026-06'));
});

test('a complete empty grouping means zero sales; a missing block does not', async () => {
  const zero = rhythm(await fixture({ zeroSales: '2026-06' }).load(input)).previous_4_months[0];
  assert.equal(zero.sales_vin, 0); assert.equal(zero.attainment_percent, 0); assert.equal(zero.difference_pp, 60);
  const missing = rhythm(await fixture({ noSales: '2026-06' }).load(input)).previous_4_months[0];
  assert.equal(missing.attainment_percent, null); assert.equal(missing.status, 'NO_CERTIFIED_SALES');
});

test('rejects incomplete/incompatible grouped input instead of producing zero or artificial evidence', async () => {
  for (const change of [e => { delete e.evidence_id; }, e => { delete e.payload.members; },
    e => { e.universe.commercial_universe = 'DEALERS'; }, e => { e.temporal.period_identity = '2026-05'; },
    e => { e.temporal.date_from = '2026-06-02'; }, e => { e.coverage.dimension_unresolved_n = 1; }]) {
    await assert.rejects(fixture({ mutate: (e, name) => { if (name === 'sales_observe_many') change(e); } }).load(input), /INCOMPLETE_RHYTHM|INCOMPATIBLE_RHYTHM|INCOMPATIBLE_ATTAINMENT/);
  }
});

test('preloaded current SALES removes two scalar requests and reuses the original calendar and STORE block', async () => {
  const baseline = fixture(), before = await baseline.load(input), f = fixture(), sales = await f.prepared();
  const saved = JSON.stringify(sales); f.calls.length = 0;
  const after = await f.load({ ...input, sales });
  const business = result => JSON.parse(JSON.stringify(result.rows,
    (key, value) => ['sales_evidence_id', 'lineage'].includes(key) ? undefined : value));
  assert.deepEqual(business(after), business(before)); assert.equal(JSON.stringify(sales), saved);
  assert.equal(baseline.calls.length, 25); assert.equal(f.calls.length, 22);
  assert.equal(f.maximum, 1);
  assert.ok(!f.calls.some(c => c.args.source === 'SALES' && c.args.period === input.period));
  assert.ok(!f.calls.some(c => c.args.evidence_shape === 'CUMULATIVE_PERIOD_OBSERVATION'));
  assert.equal(f.calls.filter(c => c.args.source === 'TARGETS').length, 12);
  const [calendar, block] = sales.evidence;
  assert.ok(after.evidence.includes(calendar)); assert.ok(after.evidence.includes(block));
  for (const e of after.evidence) assert.equal(e, f.originals.get(e.evidence_id));
  for (const row of after.rows.filter(r => r.dimension === 'STORE')) {
    const current = row.payload.rhythm.current;
    assert.equal(current.sales_evidence_id, block.evidence_id);
    assert.deepEqual(current.lineage.evidence_refs[0], { slot: 'observed', evidence_id: block.evidence_id,
      evidence_contract: 'p1.dimensional_quantitative_dataset', member_id: row.dimension_id });
  }
});

test('preloaded sales preserve zero sales, missing/zero/uncertified targets and historical exclusions', async () => {
  for (const options of [{ zeroSales: input.period }, { missingTarget: input.period }, { zeroTarget: input.period },
    { uncertifiedTarget: input.period }, { noSales: '2026-06' }, { shiftStart: true }]) {
    const baseline = await fixture(options).load(input), f = fixture(options), sales = await f.prepared();
    const result = await f.load({ ...input, sales });
    const values = rows => JSON.parse(JSON.stringify(rows, (key, value) => ['sales_evidence_id', 'lineage'].includes(key) ? undefined : value));
    assert.deepEqual(values(result.rows), values(baseline.rows));
  }
});

test('rejects incompatible or incomplete prepared SALES without recertifying P1 objects', async () => {
  const f = fixture(), sales = await f.prepared(); f.calls.length = 0;
  for (const supplied of [{ ...sales, run_id: 'other' }, { ...sales, period: '2026-09-01' },
    { ...sales, cutoff_date: '2026-10-28' }, { ...sales, evidence: [] }, null])
    await assert.rejects(f.load({ ...input, sales: supplied }), /RHYTHM_PREPARED_SALES/);
  assert.equal(f.calls.length, 0);
  for (const e of sales.evidence) { delete e.authority; delete e.status; delete e.lineage; delete e.evidence_version; }
  const result = await f.load({ ...input, sales });
  assert.equal(rhythm(result).current.attainment_percent, 60);
});
