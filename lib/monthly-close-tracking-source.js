import { withP1Mcp as defaultConnect, callP1 as defaultCall } from './p1-client.js';

const fail = () => { throw new Error('INCOMPLETE_OR_INCOMPATIBLE_SALES_P1'); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function shift(value, days) {
  const d = new Date(value + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function certified(evidence, shape) {
  if (evidence?.source !== 'SALES' || evidence.authority !== 'P1_CERTIFIED' ||
      evidence.status !== 'CERTIFIED' || !evidence.evidence_id || !evidence.evidence_version ||
      evidence.evidence_contract !== 'p1.' + shape.toLowerCase() ||
      evidence.measure?.id !== 'VIN_SALES' || evidence.measure?.unit !== 'VIN') fail();
  return evidence;
}

// store_ids is the generator's canonical roster; SALES groupings are not a store catalog.
export function createMonthlyCloseTrackingSource({ withP1Mcp = defaultConnect, callP1 = defaultCall } = {}) {
  return async function load({ run_id, period, cutoff_date, store_ids }) {
    if (typeof run_id !== 'string' || !run_id.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !date(cutoff_date) || !Array.isArray(store_ids) || !store_ids.length ||
        store_ids.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id === 'UNRESOLVED') ||
        new Set(store_ids).size !== store_ids.length) throw new Error('INVALID_SALES_SOURCE_INPUT');
    return withP1Mcp(async client => {
      const evidence = [], observe = async (shape, args) => {
        const result = certified(await callP1(client, 'data_observe', {
          run_id, source: 'SALES', measure: 'VIN_SALES', evidence_shape: shape, ...args,
        }), shape);
        evidence.push(result);
        return result;
      };
      const calendar = await observe('PERIOD_CALENDAR', { period });
      const days = calendar.payload?.eligible_observation_days;
      if (calendar.temporal?.period_identity !== period || calendar.temporal?.period_type !== 'COMMERCIAL_MONTH' ||
          !Array.isArray(days) || !days.length || days.some((day, i) => !date(day) || (i && day !== shift(days[i - 1], 1))) ||
          calendar.coverage?.eligible_days !== days.length || calendar.payload.close_boundary !== days.at(-1) ||
          !days.includes(cutoff_date)) fail();
      async function slice(from, to) {
        const observations = [];
        for (const universe of ['COMPANY', 'DEALERS', 'OWN_STORES']) {
          const grouped = universe === 'OWN_STORES';
          const e = await observe(grouped ? 'DIMENSIONAL_QUANTITATIVE_DATASET' : 'QUANTITATIVE_OBSERVATION', {
            ...(grouped ? { dimension: 'STORE' } : {}),
            filters: { commercial_universe: universe, date_from: from, date_to: to },
          });
          if (e.universe?.commercial_universe !== universe || e.temporal?.date_from !== from ||
              e.temporal?.date_to !== to || e.temporal?.date_semantics !== 'fecha_factura' ||
              e.grain !== 'FILTERED_SALES_UNIVERSE' || !count(e.coverage?.filtered_n) ||
              Object.keys(e.dimensions || {}).length) fail();
          if (!grouped && (!count(e.payload?.value) || e.payload.value !== e.coverage.filtered_n)) fail();
          if (grouped) {
            const members = e.payload?.members;
            if (e.payload?.dimension?.id !== 'STORE' || !Array.isArray(members) ||
                e.coverage.dimension_unresolved_n !== 0 || e.coverage.dimension_resolved_n !== e.coverage.filtered_n ||
                members.some(m => typeof m.member_id !== 'string' || !m.member_id.trim() || m.member_id !== m.member_id.trim() || m.member_id === 'UNRESOLVED' || !count(m.value)) ||
                new Set(members.map(m => m.member_id)).size !== members.length ||
                members.reduce((sum, m) => sum + m.value, 0) !== e.coverage.filtered_n) fail();
          }
          observations.push(e);
        }
        return observations;
      }
      const accumulated = await slice(days[0], cutoff_date);
      const monday = shift(cutoff_date, -((new Date(cutoff_date + 'T12:00:00Z').getUTCDay() + 6) % 7));
      const daily = [];
      for (let i = 0; i < 6; i++) {
        const day = shift(monday, i), status = !days.includes(day) ? 'OUTSIDE_PERIOD' : day > cutoff_date ? 'AFTER_CUTOFF' : 'OBSERVED';
        daily.push({ date: day, status, observations: status === 'OBSERVED' ? await slice(day, day) : null });
      }
      const ids = [...new Set([...store_ids, ...[accumulated, ...daily.map(d => d.observations)].filter(Boolean)
        .flatMap(observations => observations[2].payload.members.map(m => m.member_id))])];
      const metric = (observations, index, id) => ({ value: index < 2 ? observations[index].payload.value :
        observations[2].payload.members.find(m => m.member_id === id)?.value ?? 0,
        evidence_id: observations[index].evidence_id });
      const scopes = [['COMPANY', 'ALL', 0], ['DEALERS', 'ALL', 1], ...ids.map(id => ['STORE', id, 2])];
      const rows = scopes.map(([dimension, dimension_id, index]) => ({ dimension, dimension_id, payload: {
        commercial_universe: ['COMPANY', 'DEALERS', 'OWN_STORES'][index], date_from: days[0], cutoff_date,
        sales_mtd: metric(accumulated, index, dimension_id), daily: daily.map(d => ({ date: d.date, status: d.status,
          ...(d.observations ? metric(d.observations, index, dimension_id) : { value: null, evidence_id: null }) })),
      } }));
      return { run_id, period: period + '-01', cutoff_date, week_start: monday, rows,
        expected_members: rows.map(({ dimension, dimension_id }) => ({ dimension, dimension_id })),
        own_stores_total: accumulated[2].coverage.filtered_n,
        sources: { sales: { calendar_evidence_id: calendar.evidence_id, evidence_ids: evidence.map(e => e.evidence_id) } }, evidence };
    });
  };
}
