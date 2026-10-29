import { withP1Mcp as defaultConnect, callP1 as defaultCall } from './p1-client.js';

const fail = message => { throw new Error(message); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function createMonthlyCloseTrackingYoy({ withP1Mcp = defaultConnect, callP1 = defaultCall } = {}) {
  // Optional sales: one source-helper result or an array (current and/or previous year).
  // Reuse original P1 blocks, never fabricate scalar evidence for grouped STORE values.
  return async function load({ run_id, period, cutoff_date, store_ids, sales = [] }) {
    if (typeof run_id !== 'string' || !run_id.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !validDate(cutoff_date) || !Array.isArray(store_ids) || !store_ids.length ||
        store_ids.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id === 'UNRESOLVED') ||
        new Set(store_ids).size !== store_ids.length) fail('INVALID_YOY_INPUT');
    const previous = String(Number(period.slice(0, 4)) - 1).padStart(4, '0') + period.slice(4);
    const prepared = Array.isArray(sales) ? sales : [sales];
    if (prepared.some(s => s?.run_id !== run_id || ![period + '-01', previous + '-01'].includes(s.period) ||
        !Array.isArray(s.evidence))) fail('INCOMPATIBLE_YOY_PREPARED_SALES');
    return withP1Mcp(async client => {
      const available = prepared.flatMap(s => s.evidence), evidence = [];
      const call = (name, args) => callP1(client, name, { run_id, ...args });
      async function calendar(month) {
        const e = available.find(e => e.evidence_contract === 'p1.period_calendar' && e.temporal?.period_identity === month) ||
          await call('data_observe', { source: 'SALES', measure: 'VIN_SALES', evidence_shape: 'PERIOD_CALENDAR', period: month });
        const days = e?.payload?.eligible_observation_days;
        if (e?.source !== 'SALES' || !e.evidence_id || e.temporal?.period_identity !== month ||
            !Array.isArray(days) || !days.length || days.some(d => !validDate(d))) fail('INVALID_YOY_CALENDAR');
        evidence.push(e); return days;
      }
      const currentDays = await calendar(period), baselineDays = await calendar(previous);
      const index = currentDays.indexOf(cutoff_date), baselineCut = baselineDays[index];
      if (index < 0 || !baselineCut || (index === currentDays.length - 1) !==
          (index === baselineDays.length - 1)) fail('NO_EQUIVALENT_YOY_CUTOFF');
      if (prepared.some(s => s.cutoff_date !== (s.period === period + '-01' ? cutoff_date : baselineCut)))
        fail('INCOMPATIBLE_YOY_PREPARED_SALES');
      async function block(month, days, universe) {
        const grouped = universe === 'OWN_STORES', kind = grouped ? 'STORE' : 'TOTAL';
        const contract = grouped ? 'p1.dimensional_quantitative_dataset' : 'p1.quantitative_observation';
        let e = available.find(e => e.evidence_contract === contract && e.universe?.commercial_universe === universe &&
          e.temporal?.date_from === days[0] && e.temporal.date_to === days[index]);
        if (!e) {
          const result = await call('sales_observe_many', { period: month, cutoff: days[index],
            commercial_universe: universe, operations: [{ kind }] });
          if (result?.source !== 'SALES' || result.period !== month || result.cutoff !== days[index] ||
              result.commercial_universe !== universe) fail('INCOMPATIBLE_YOY_P1_BLOCK');
          e = result.results?.find(r => r.operation?.kind === kind)?.evidence;
        }
        if (e?.source !== 'SALES' || !e.evidence_id || e.evidence_contract !== contract ||
            e.measure?.id !== 'VIN_SALES' || e.universe?.commercial_universe !== universe ||
            e.temporal?.date_from !== days[0] || e.temporal.date_to !== days[index] ||
            Object.keys(e.dimensions || {}).length || (!grouped && !count(e.payload?.value))) fail('INCOMPATIBLE_YOY_P1_BLOCK');
        if (grouped && (e.payload?.dimension?.id !== 'STORE' || !Array.isArray(e.payload.members) ||
            e.coverage?.dimension_unresolved_n !== 0 || e.payload.members.some(m => m.member_id == null ||
              String(m.member_id) === 'UNRESOLVED' || !count(m.value)) ||
            new Set(e.payload.members.map(m => String(m.member_id))).size !== e.payload.members.length)) fail('INCOMPLETE_YOY_P1_BLOCK');
        evidence.push(e); return e;
      }
      const rows = [];
      for (const universe of ['COMPANY', 'DEALERS', 'OWN_STORES']) {
        const baseline = await block(previous, baselineDays, universe), comparison = await block(period, currentDays, universe);
        const grouped = universe === 'OWN_STORES';
        for (const id of grouped ? store_ids : ['ALL']) {
          // An absent member in a complete P1 grouping has zero recognized sales; a missing block does not.
          const value = e => grouped ? e.payload.members.find(m => String(m.member_id) === id)?.value ?? 0 : e.payload.value;
          const baseline_value = value(baseline), comparison_value = value(comparison);
          const absolute_delta = comparison_value - baseline_value;
          const relative_delta = baseline_value === 0 ? null : absolute_delta / baseline_value;
          const ref = (e, month, days) => ({ period: month, date_from: days[0], cutoff_date: days[index],
            evidence_id: e.evidence_id, evidence_contract: e.evidence_contract, ...(grouped ? { member_id: id } : {}) });
          rows.push({ dimension: grouped ? 'STORE' : universe, dimension_id: id, payload: { yoy: {
            baseline_value, comparison_value, absolute_delta, relative_delta,
            relative_delta_status: baseline_value === 0 ? 'ZERO_BASELINE' : 'CALCULATED',
            direction: absolute_delta > 0 ? 'INCREASE' : absolute_delta < 0 ? 'DECREASE' : 'UNCHANGED',
            percentage_delta: relative_delta === null ? null : relative_delta * 100, commercial_universe: universe,
            baseline: ref(baseline, previous, baselineDays), comparison: ref(comparison, period, currentDays),
            lineage: { calculation: 'LOCAL_YOY', run_id, evidence_refs: [baseline, comparison].map((e, i) => ({
              slot: i ? 'comparison' : 'baseline', evidence_id: e.evidence_id, evidence_contract: e.evidence_contract,
              ...(grouped ? { member_id: id } : {}) })) },
          } } });
        }
      }
      return { run_id, period: period + '-01', cutoff_date, rows,
        sources: { yoy: { calendar_evidence_ids: evidence.slice(0, 2).map(e => e.evidence_id),
          evidence_ids: evidence.map(e => e.evidence_id), calculation: 'LOCAL_YOY' } }, evidence };
    });
  };
}
