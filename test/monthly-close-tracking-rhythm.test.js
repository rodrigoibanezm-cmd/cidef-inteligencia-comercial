import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyCloseTrackingRhythm } from '../lib/monthly-close-tracking-rhythm.js';

const input = { run_id: 'rhythm-test', period: '2026-10', cutoff_date: '2026-10-29', store_ids: ['8', '22'] };
const plan = { '2026-10': [60, 100], '2026-06': [20, 50], '2026-07': [90, 100],
  '2026-08': [30, 100], '2026-09': [60, 200], '2025-10': [50, 100] };
function fixture(options = {}) {
  const calls = [], originals = new Map();
  const load = createMonthlyCloseTrackingRhythm({ withP1Mcp: async callback => callback('mock'),
    callP1: async (client, name, args) => {
      assert.equal(client, 'mock'); calls.push({ name, args });
      const p = args.period, id = args.filters?.store_id;
      if (name === 'p2_execute') {
        const observed = originals.get(args.evidence.observed), target = originals.get(args.evidence.reference);
        const value = observed.payload.observed_value, meta = target.payload.value;
        return { status: 'EXECUTED', result: { observed_value: value, reference_value: meta,
          absolute_deviation: value - meta, relative_deviation: meta === 0 ? null : (value - meta) / meta,
          relative_deviation_status: meta === 0 ? 'ZERO_REFERENCE' : 'CALCULATED',
          direction: value < meta ? 'BELOW_REFERENCE' : value > meta ? 'ABOVE_REFERENCE' : 'ON_REFERENCE' },
          lineage: { run_id: args.run_id, execution_id: 'exec-' + calls.length, unit_id: args.unit_id, contract_version: args.contract_version,
            evidence_refs: Object.entries(args.evidence).map(([slot, evidence_id]) => ({ slot, evidence_id })) } };
      }
      assert.equal(name, 'data_observe');
      const e = { source: args.source, authority: 'P1_CERTIFIED', status: 'CERTIFIED', evidence_id: 'original-' + calls.length,
        evidence_version: '0.1.0', evidence_contract: 'p1.' + args.evidence_shape.toLowerCase(), lineage: { certifier: args.source } };
      const [year, month] = p.split('-').map(Number), offset = Number(Boolean(options.shiftStart));
      const first = new Date(Date.UTC(year, month - 1, 1 + offset)).toISOString().slice(0, 10);
      const [value, target] = id === '22' ? [10, 20] : plan[p];
      if (args.evidence_shape === 'PERIOD_CALENDAR') {
        const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const days = Array.from({ length: n }, (_, i) => new Date(Date.UTC(year, month - 1, i + 1 + offset)).toISOString().slice(0, 10));
        Object.assign(e, { measure: { id: 'VIN_SALES', unit: 'VIN' }, temporal: { period_identity: p, period_type: 'COMMERCIAL_MONTH', close_boundary: days.at(-1) },
          payload: { eligible_observation_days: days, close_boundary: days.at(-1) }, coverage: { eligible_days: n } });
      } else if (args.source === 'SALES') {
        if (options.noSales === p) return null;
        Object.assign(e, { grain: 'FILTERED_SALES_UNIVERSE', measure: { id: 'VIN_SALES', unit: 'VIN', aggregation: 'COUNT_RECOGNIZED_SALE' },
          universe: { commercial_universe: 'OWN_STORES' }, dimensions: { store_id: id }, payload: { observed_value: value },
          temporal: { period_identity: p, period_type: 'COMMERCIAL_MONTH', date_from: first, date_to: args.cutoff, cutoff: args.cutoff, date_semantics: 'fecha_factura' },
          coverage: { source_n: 100, filtered_n: value } });
      } else {
        assert.equal(args.source, 'TARGETS');
        if (options.missingTarget === p) throw new Error('TARGET_REFERENCE_NOT_FOUND');
        if (options.uncertifiedTarget === p) e.authority = 'UNVERIFIED';
        Object.assign(e, { grain: 'STORE_MONTH', measure: { id: 'VIN_TARGET', unit: 'VIN', aggregation: 'EXPLICIT_TARGET' },
          universe: { commercial_universe: 'OWN_STORES' }, dimensions: { store_id: id }, temporal: { period_identity: p },
          coverage: { complete: true, rows: 1 }, payload: { value: options.zeroTarget === p ? 0 : target, reference_type: 'OFFICIAL_TARGET', source: 'official-plan' } });
      }
      originals.set(e.evidence_id, e); return e;
    } });
  return { load, calls, originals };
}
const rhythm = (result, id = '8') => result.rows.find(row => row.dimension === 'STORE' && row.dimension_id === id).payload.rhythm;

test('builds four prior months and YoY using original evidence and existing attainment/P2', async () => {
  const { load, calls, originals } = fixture(), result = await load(input), r = rhythm(result);
  assert.deepEqual(r.previous_4_months.map(p => p.period), ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(r.yoy.period, '2025-10'); assert.equal(r.coverage.comparable_references, 5);
  assert.ok(calls.every(c => c.args.run_id === input.run_id));
  for (const c of calls.filter(c => c.name === 'p2_execute')) {
    assert.equal(c.args.unit_id, 'p2.reference_deviation');
    for (const id of Object.values(c.args.evidence)) assert.ok(result.evidence.includes(originals.get(id)));
  }
  assert.ok(result.rows.filter(r => r.dimension !== 'STORE').every(r => r.payload.rhythm === null));
});

test('aligns by commercial day and excludes shorter or closed historical periods', async () => {
  const { load, calls } = fixture({ shiftStart: true }), result = await load(input);
  assert.equal(result.commercial_day, 28);
  assert.ok(calls.filter(c => c.args.source === 'SALES' && c.args.cutoff).every(c => c.args.cutoff.endsWith('-29')));
  assert.equal(rhythm(result).yoy.date_from, '2025-10-02');
  const plain = fixture(), end = rhythm(await plain.load({ ...input, cutoff_date: '2026-10-30' }));
  assert.equal(end.previous_4_months[0].status, 'NO_EQUIVALENT_CUTOFF');
  assert.equal(end.previous_4_months[3].comparison_status, 'EXCLUDED');
  assert.ok(!plain.calls.some(c => c.args.cutoff && ['2026-06', '2026-09'].includes(c.args.period)));
});

test('expresses differences in percentage points, comparing each store independently', async () => {
  const result = await fixture().load(input), r = rhythm(result);
  assert.ok(Math.abs(r.current.attainment_percent - 60) < 1e-9);
  r.previous_4_months.forEach((p, i) => assert.ok(Math.abs(p.difference_pp - [20, -30, 30, 30][i]) < 1e-9));
  assert.ok(Math.abs(r.yoy.difference_pp - 10) < 1e-9);
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
});
