import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyCloseTrackingSource } from '../lib/monthly-close-tracking-source.js';

const input = { run_id: 'tracking-test', period: '2026-10', cutoff_date: '2026-10-29', store_ids: ['8', '22', '9'] };
function fixture(mutate = () => {}) {
  const calls = [], days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const load = createMonthlyCloseTrackingSource({
    withP1Mcp: async callback => callback('simulated-client'),
    callP1: async (client, name, args) => {
      assert.equal(client, 'simulated-client'); assert.equal(name, 'data_observe');
      calls.push(args);
      const shape = args.evidence_shape, f = args.filters || {}, day = f.date_to;
      const daily = f.date_from === day;
      const members = !daily ? [{ member_id: '8', value: 2 }, { member_id: '22', value: 1 }] :
        day === '2026-10-26' || day === '2026-10-29' ? [{ member_id: '8', value: 1 }] :
        day === '2026-10-27' ? [{ member_id: '22', value: 1 }] : [];
      const own = members.reduce((sum, m) => sum + m.value, 0);
      const value = f.commercial_universe === 'COMPANY' ? (daily ? { '2026-10-26': 1, '2026-10-27': 2, '2026-10-29': 2 }[day] ?? 0 : 5) :
        (daily ? { '2026-10-27': 1, '2026-10-29': 2 }[day] ?? 0 : 3);
      const e = { evidence_id: JSON.stringify(args), evidence_version: '0.1.0', authority: 'P1_CERTIFIED',
        status: 'CERTIFIED', source: 'SALES', evidence_contract: 'p1.' + shape.toLowerCase(),
        measure: { id: 'VIN_SALES', unit: 'VIN' }, grain: 'FILTERED_SALES_UNIVERSE', dimensions: {},
        universe: { commercial_universe: f.commercial_universe },
        temporal: { date_from: f.date_from, date_to: day, date_semantics: 'fecha_factura' },
        coverage: { filtered_n: value }, payload: { value } };
      if (shape === 'PERIOD_CALENDAR') Object.assign(e, { grain: 'COMMERCIAL_MONTH', universe: {},
        temporal: { period_identity: args.period, period_type: 'COMMERCIAL_MONTH', close_boundary: days.at(-1) },
        coverage: { eligible_days: days.length }, payload: { eligible_observation_days: days, close_boundary: days.at(-1) } });
      if (shape === 'DIMENSIONAL_QUANTITATIVE_DATASET') Object.assign(e, {
        coverage: { filtered_n: own, dimension_resolved_n: own, dimension_unresolved_n: 0 },
        payload: { dimension: { id: 'STORE', unresolved_member_policy: 'EXPLICIT_UNRESOLVED_MEMBER' }, members } });
      mutate(e, args);
      return e;
    },
  });
  return { load, calls };
}

test('separates certified universes without adding overlapping scopes', async () => {
  const { load, calls } = fixture(), result = await load(input);
  const row = id => result.rows.find(r => r.dimension === id);
  assert.equal(row('COMPANY').payload.sales_mtd.value, 5);
  assert.equal(row('DEALERS').payload.sales_mtd.value, 3);
  assert.equal(result.own_stores_total, 3);
  assert.deepEqual(new Set(calls.filter(c => c.filters).map(c => c.filters.commercial_universe)), new Set(['COMPANY', 'DEALERS', 'OWN_STORES']));
  assert.ok(calls.every(c => c.run_id === input.run_id && c.source === 'SALES'));
  assert.deepEqual(result.expected_members, result.rows.map(({ dimension, dimension_id }) => ({ dimension, dimension_id })));
});

test('reconciles STORE and preserves certified zero, rejecting mismatched totals', async () => {
  const result = await fixture().load(input), stores = result.rows.filter(r => r.dimension === 'STORE');
  assert.equal(stores.reduce((sum, r) => sum + r.payload.sales_mtd.value, 0), result.own_stores_total);
  assert.equal(stores.find(r => r.dimension_id === '9').payload.sales_mtd.value, 0);
  const zero = stores[0].payload.daily.find(d => d.date === '2026-10-28');
  assert.equal(zero.value, 0); assert.ok(zero.evidence_id); assert.equal(zero.status, 'OBSERVED');
  await assert.rejects(fixture(e => { if (e.payload?.members?.length) e.payload.members[0].value++; }).load(input), /INCOMPLETE/);
});

test('uses the P1 commercial calendar and never invents future or out-of-period sales', async () => {
  const { load, calls } = fixture(), result = await load({ ...input, cutoff_date: '2026-10-01' });
  assert.equal(result.week_start, '2026-09-28');
  assert.deepEqual(result.rows[0].payload.daily.map(d => d.status), ['OUTSIDE_PERIOD', 'OUTSIDE_PERIOD', 'OUTSIDE_PERIOD', 'OBSERVED', 'AFTER_CUTOFF', 'AFTER_CUTOFF']);
  assert.ok(result.rows[0].payload.daily.filter(d => d.status !== 'OBSERVED').every(d => d.value === null && d.evidence_id === null));
  assert.ok(calls.filter(c => c.filters).every(c => c.filters.date_from >= '2026-10-01' && c.filters.date_to <= '2026-10-01'));
  const shifted = fixture(e => { if (e.payload?.eligible_observation_days) {
    e.payload.eligible_observation_days.shift(); e.coverage.eligible_days--;
  } });
  const adjusted = await shifted.load(input);
  assert.equal(adjusted.rows[0].payload.date_from, '2026-10-02');
  await assert.rejects(fixture().load({ ...input, cutoff_date: '2026-11-01' }), /INCOMPLETE/);
  await assert.rejects(fixture().load({ ...input, cutoff_date: '2026-10-32' }), /INVALID/);
});

test('rejects missing, partial, incompatible or unresolved evidence instead of treating it as zero', async () => {
  for (const mutate of [e => { delete e.evidence_id; }, e => { e.status = 'PARTIAL'; },
    e => { e.measure.id = 'OTHER'; }, e => { if (e.payload?.members) delete e.payload.members; },
    e => { if (e.payload?.members) e.coverage.dimension_unresolved_n = 1; },
    (e, a) => { if (a.filters) e.universe.commercial_universe = 'WRONG'; },
    (e, a) => { if (a.filters) e.temporal.date_to = '2026-10-28'; }]) {
    await assert.rejects(fixture(mutate).load(input), /INCOMPLETE/);
  }
});
