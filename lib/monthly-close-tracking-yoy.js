import { withP1Mcp as defaultConnect, callP1 as defaultCall } from './p1-client.js';

const UNIT = 'p2.observed_pair_delta', VERSION = '0.1.0';
const fail = message => { throw new Error(message); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function certified(e, shape) {
  if (e?.source !== 'SALES' || e.authority !== 'P1_CERTIFIED' || e.status !== 'CERTIFIED' ||
      !e.evidence_id || !e.evidence_version || !e.lineage || e.evidence_contract !== 'p1.' + shape.toLowerCase() ||
      e.measure?.id !== 'VIN_SALES' || e.measure?.unit !== 'VIN') fail('INVALID_YOY_P1_EVIDENCE');
  return e;
}

export function createMonthlyCloseTrackingYoy({ withP1Mcp = defaultConnect, callP1 = defaultCall } = {}) {
  return async function load({ run_id, period, cutoff_date, store_ids }) {
    if (typeof run_id !== 'string' || !run_id.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !validDate(cutoff_date) || !Array.isArray(store_ids) || !store_ids.length ||
        store_ids.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id === 'UNRESOLVED') ||
        new Set(store_ids).size !== store_ids.length) fail('INVALID_YOY_INPUT');
    const previous = String(Number(period.slice(0, 4)) - 1).padStart(4, '0') + period.slice(4);
    return withP1Mcp(async client => {
      const evidence = [], call = (name, args) => callP1(client, name, { run_id, ...args });
      async function calendar(month) {
        const e = certified(await call('data_observe', { source: 'SALES', measure: 'VIN_SALES',
          evidence_shape: 'PERIOD_CALENDAR', period: month }), 'PERIOD_CALENDAR');
        const days = e.payload?.eligible_observation_days;
        if (e.temporal?.period_identity !== month || e.temporal.period_type !== 'COMMERCIAL_MONTH' ||
            !Array.isArray(days) || !days.length || days.some((d, i) => !validDate(d) ||
              (i && Date.parse(d) - Date.parse(days[i - 1]) !== 86400000)) ||
            e.coverage?.eligible_days !== days.length || e.payload.close_boundary !== days.at(-1) ||
            e.temporal.close_boundary !== days.at(-1)) fail('INVALID_YOY_CALENDAR');
        evidence.push(e);
        return days;
      }
      const currentDays = await calendar(period), baselineDays = await calendar(previous);
      const index = currentDays.indexOf(cutoff_date), baselineCut = baselineDays[index];
      if (index < 0 || !baselineCut || (index === currentDays.length - 1) !==
          (index === baselineDays.length - 1)) fail('NO_EQUIVALENT_YOY_CUTOFF');
      async function scalar(universe, id, days) {
        const filters = { commercial_universe: universe, date_from: days[0], date_to: days[index],
          ...(id ? { store_id: id } : {}) };
        // No top-level period: scalar observeSales would replace the explicit end with month-end.
        const e = certified(await call('data_observe', { source: 'SALES', measure: 'VIN_SALES',
          evidence_shape: 'QUANTITATIVE_OBSERVATION', filters }), 'QUANTITATIVE_OBSERVATION');
        if (e.grain !== 'FILTERED_SALES_UNIVERSE' || e.measure.aggregation !== 'COUNT_RECOGNIZED_SALE' ||
            JSON.stringify(e.universe) !== JSON.stringify({ commercial_universe: universe }) ||
            JSON.stringify(e.dimensions) !== JSON.stringify(id ? { store_id: id } : {}) ||
            e.temporal?.date_from !== filters.date_from || e.temporal.date_to !== filters.date_to ||
            e.temporal.date_semantics !== 'fecha_factura' || !count(e.payload?.value) ||
            e.coverage?.filtered_n !== e.payload.value || !count(e.coverage?.source_n) ||
            e.coverage.source_n < e.coverage.filtered_n) fail('INCOMPATIBLE_YOY_P1_EVIDENCE');
        evidence.push(e);
        return e;
      }
      const rows = [], scopes = [['COMPANY', 'ALL', 'COMPANY'], ['DEALERS', 'ALL', 'DEALERS'],
        ...store_ids.map(id => ['STORE', id, 'OWN_STORES'])];
      for (const [dimension, dimension_id, universe] of scopes) {
        const id = dimension === 'STORE' ? dimension_id : null;
        const baseline = await scalar(universe, id, baselineDays), comparison = await scalar(universe, id, currentDays);
        const refs = { baseline: baseline.evidence_id, comparison: comparison.evidence_id };
        const p2 = await call('p2_execute', { unit_id: UNIT, contract_version: VERSION, evidence: refs });
        const r = p2?.result, lineage = p2?.lineage;
        if (p2?.status !== 'EXECUTED' || lineage?.unit_id !== UNIT || lineage.run_id !== run_id ||
            lineage.contract_version !== VERSION || !lineage.execution_id ||
            !Array.isArray(lineage.evidence_refs) || lineage.evidence_refs.length !== 2 ||
            Object.entries(refs).some(([slot, ref]) => !lineage.evidence_refs.some(e => e.slot === slot && e.evidence_id === ref)) ||
            r?.baseline_value !== baseline.payload.value || r?.comparison_value !== comparison.payload.value ||
            !Number.isFinite(r?.absolute_delta) || !['INCREASE', 'DECREASE', 'UNCHANGED'].includes(r.direction) ||
            (baseline.payload.value === 0 ? r.relative_delta !== null || r.relative_delta_status !== 'ZERO_BASELINE' :
              !Number.isFinite(r.relative_delta) || r.relative_delta_status !== 'CALCULATED')) fail('INVALID_YOY_P2_RESULT');
        rows.push({ dimension, dimension_id, payload: { yoy: { ...r,
          percentage_delta: r.relative_delta === null ? null : r.relative_delta * 100,
          commercial_universe: universe, baseline: { period: previous, date_from: baselineDays[0], cutoff_date: baselineCut,
            evidence_id: baseline.evidence_id }, comparison: { period, date_from: currentDays[0], cutoff_date,
            evidence_id: comparison.evidence_id }, lineage } } });
      }
      return { run_id, period: period + '-01', cutoff_date, rows,
        sources: { yoy: { calendar_evidence_ids: evidence.slice(0, 2).map(e => e.evidence_id),
          evidence_ids: evidence.map(e => e.evidence_id), p2_unit: UNIT, p2_version: VERSION } }, evidence };
    });
  };
}
