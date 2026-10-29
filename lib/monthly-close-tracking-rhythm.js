import { withP1Mcp as defaultConnect, callP1 as defaultCall } from './p1-client.js';
import { createMonthlyCloseTrackingAttainment } from './monthly-close-tracking-attainment.js';

const fail = message => { throw new Error(message); };
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const certified = e => e?.authority === 'P1_CERTIFIED' && e.status === 'CERTIFIED' &&
  e.evidence_id && e.evidence_version && e.lineage;
function monthShift(period, offset) {
  const [year, month] = period.split('-').map(Number), d = new Date(Date.UTC(year, month - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

export function createMonthlyCloseTrackingRhythm({ withP1Mcp = defaultConnect, callP1 = defaultCall } = {}) {
  return async function load({ run_id, period, cutoff_date, store_ids }) {
    if (typeof run_id !== 'string' || !run_id.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !date(cutoff_date) || !Array.isArray(store_ids) || !store_ids.length ||
        store_ids.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id === 'UNRESOLVED') ||
        new Set(store_ids).size !== store_ids.length) fail('INVALID_RHYTHM_INPUT');
    return withP1Mcp(async client => {
      const evidence = [], periods = [period, ...[-4, -3, -2, -1, -12].map(offset => monthShift(period, offset))];
      const points = new Map(store_ids.map(id => [id, []]));
      const attainment = createMonthlyCloseTrackingAttainment({ withP1Mcp: callback => callback(client), callP1 });
      async function observe(shape, args) {
        try { return await callP1(client, 'data_observe', { run_id, source: 'SALES', measure: 'VIN_SALES', evidence_shape: shape, ...args }); }
        catch (error) { if (!/\bNO_CERTIFIED_DATA_IN_PERIOD\b/.test(error?.message || '')) throw error; return null; }
      }
      let index, currentClosed;
      for (const month of periods) {
        const calendar = await observe('PERIOD_CALENDAR', { period: month });
        let days = null;
        if (certified(calendar)) {
          days = calendar.payload?.eligible_observation_days;
          if (calendar.source !== 'SALES' || calendar.evidence_contract !== 'p1.period_calendar' ||
              calendar.measure?.id !== 'VIN_SALES' || calendar.measure.unit !== 'VIN' || calendar.temporal?.period_identity !== month ||
              calendar.temporal.period_type !== 'COMMERCIAL_MONTH' || !Array.isArray(days) || !days.length ||
              days.some((d, i) => !date(d) || (i && Date.parse(d) - Date.parse(days[i - 1]) !== 86400000)) ||
              calendar.coverage?.eligible_days !== days.length || calendar.payload.close_boundary !== days.at(-1) ||
              calendar.temporal.close_boundary !== days.at(-1)) fail('INVALID_RHYTHM_CALENDAR');
          evidence.push(calendar);
        }
        if (month === period) {
          index = days?.indexOf(cutoff_date) ?? -1;
          if (index < 0) fail('INVALID_CURRENT_RHYTHM_CUTOFF');
          currentClosed = index === days.length - 1;
        }
        const cut = days?.[index] ?? null;
        const comparable = cut !== null && currentClosed === (index === days.length - 1);
        const sales = [], entries = new Map();
        for (const id of store_ids) {
          const point = { period: month, cutoff_date: cut, date_from: days?.[0] ?? null,
            status: days ? 'NO_EQUIVALENT_CUTOFF' : 'NO_CERTIFIED_CALENDAR', attainment_percent: null };
          entries.set(id, point); points.get(id).push(point);
          if (!comparable) continue;
          const e = await observe('CUMULATIVE_PERIOD_OBSERVATION', { period: month, cutoff: cut,
            filters: { commercial_universe: 'OWN_STORES', store_id: id } });
          point.status = 'NO_CERTIFIED_SALES';
          if (!certified(e)) continue;
          if (e.temporal?.date_from !== days[0]) fail('INCOMPATIBLE_RHYTHM_SALES_CALENDAR');
          sales.push({ dimension: 'STORE', dimension_id: id, evidence: e });
        }
        if (sales.length) {
          const result = await attainment({ run_id, period: month, cutoff_date: cut, sales });
          evidence.push(...result.evidence);
          for (const row of result.rows) Object.assign(entries.get(row.dimension_id), row.payload.attainment);
        }
      }
      const rows = ['COMPANY', 'DEALERS'].map(dimension => ({ dimension, dimension_id: 'ALL',
        payload: { rhythm: null, rhythm_status: 'UNSUPPORTED_BY_TARGETS_P1' } }));
      for (const [id, series] of points) {
        const [current, ...history] = series;
        const comparisons = history.map(point => {
          const comparable = current.attainment_percent !== null && point.attainment_percent !== null;
          return { ...point, comparison_status: comparable ? 'COMPARABLE' : 'EXCLUDED',
            exclusion_reason: comparable ? null : current.attainment_percent === null ? 'CURRENT_' + current.status : point.status,
            // Presentation difference of existing attainment outputs; never fabricated P1 evidence.
            difference_pp: comparable ? current.attainment_percent - point.attainment_percent : null };
        });
        const n = comparisons.filter(point => point.comparison_status === 'COMPARABLE').length;
        rows.push({ dimension: 'STORE', dimension_id: id, payload: { rhythm: { current,
          previous_4_months: comparisons.slice(0, 4), yoy: comparisons[4],
          coverage: { requested_references: 5, comparable_references: n, excluded_references: 5 - n } } } });
      }
      return { run_id, period: period + '-01', cutoff_date, commercial_day: index + 1, rows, evidence,
        sources: { rhythm: { evidence_ids: evidence.map(e => e.evidence_id), p2_unit: 'p2.reference_deviation', p2_version: '0.1.0' } } };
    });
  };
}
