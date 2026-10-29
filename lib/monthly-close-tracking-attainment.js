import { withP1Mcp as defaultConnect, callP1 as defaultCall } from './p1-client.js';

const fail = message => { throw new Error(message); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const identity = (e, source, contract) => e?.source === source && e.evidence_id && e.evidence_contract === contract;

// sales: [{ dimension, dimension_id, evidence }]. Evidence is an original cumulative
// observation or the original STORE grouping from sales_observe_many (shared by stores).
export function createMonthlyCloseTrackingAttainment({ withP1Mcp = defaultConnect, callP1 = defaultCall } = {}) {
  return async function load({ run_id, period, cutoff_date, sales }) {
    if (typeof run_id !== 'string' || !run_id.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !date(cutoff_date) || !Array.isArray(sales) || !sales.length) fail('INVALID_ATTAINMENT_INPUT');
    const keys = new Set();
    const observations = sales.map(({ dimension, dimension_id, evidence: e }) => {
      const universe = { COMPANY: 'COMPANY', DEALERS: 'DEALERS', STORE: 'OWN_STORES' }[dimension];
      const grouped = dimension === 'STORE' && e?.evidence_contract === 'p1.dimensional_quantitative_dataset';
      const dimensions = dimension === 'STORE' ? { store_id: dimension_id } : {};
      const key = JSON.stringify([dimension, dimension_id]);
      if (!universe || typeof dimension_id !== 'string' || !dimension_id.trim() || dimension_id !== dimension_id.trim() ||
          dimension_id === 'UNRESOLVED' || (dimension !== 'STORE' && dimension_id !== 'ALL') || keys.has(key) ||
          !identity(e, 'SALES', grouped ? 'p1.dimensional_quantitative_dataset' : 'p1.cumulative_period_observation') ||
          e.measure?.id !== 'VIN_SALES' || e.measure.unit !== 'VIN' ||
          JSON.stringify(e.universe) !== JSON.stringify({ commercial_universe: universe }) ||
          JSON.stringify(e.dimensions) !== JSON.stringify(grouped ? {} : dimensions) || e.temporal?.period_identity !== period ||
          e.temporal.period_type !== 'COMMERCIAL_MONTH' || e.temporal.cutoff !== cutoff_date ||
          e.temporal.date_to !== cutoff_date || !date(e.temporal.date_from) || e.temporal.date_from > cutoff_date)
        fail('INCOMPATIBLE_ATTAINMENT_SALES');
      if (grouped && (e.payload?.dimension?.id !== 'STORE' || !Array.isArray(e.payload.members) ||
          e.coverage?.dimension_unresolved_n !== 0)) fail('INCOMPATIBLE_ATTAINMENT_SALES');
      const member = grouped ? e.payload.members.find(m => String(m.member_id) === dimension_id) : null;
      // A store absent from the complete P1 grouping has zero sales; a missing block is invalid.
      const value = grouped ? (member ? member.value : 0) : e.payload?.observed_value;
      if (!count(value)) fail('INCOMPATIBLE_ATTAINMENT_SALES');
      keys.add(key);
      return { dimension, dimension_id, evidence: e, value, grouped };
    });
    return withP1Mcp(async client => {
      const rows = [], evidence = sales.map(row => row.evidence), call = (name, args) => callP1(client, name, { run_id, ...args });
      for (const { dimension, dimension_id, evidence: observed, value, grouped } of observations) {
        const result = { status: 'UNSUPPORTED_TARGET_SCOPE', period, cutoff_date,
          commercial_universe: observed.universe.commercial_universe, sales_vin: value,
          target_vin: null, attainment_percent: null, gap_vin: null,
          sales_evidence_id: observed.evidence_id, target_evidence_id: null, lineage: null };
        if (dimension === 'STORE') {
          let target;
          try { target = await call('data_observe', { source: 'TARGETS', measure: 'VIN_TARGET',
            evidence_shape: 'REFERENCE_OBSERVATION', period, filters: { store_id: dimension_id } }); }
          catch (error) { if (!/\bTARGET_REFERENCE_NOT_FOUND\b/.test(error?.message || '')) throw error; }
          result.status = target == null ? 'TARGET_NOT_FOUND' : 'UNCERTIFIED_TARGET';
          if (target?.authority === 'P1_CERTIFIED' && target.status === 'CERTIFIED') {
            if (!identity(target, 'TARGETS', 'p1.reference_observation') ||
                target.measure?.id !== 'VIN_TARGET' || target.measure.unit !== 'VIN' ||
                JSON.stringify(target.universe) !== JSON.stringify(observed.universe) ||
                JSON.stringify(target.dimensions) !== JSON.stringify({ store_id: dimension_id }) || target.temporal?.period_identity !== period ||
                target.coverage?.complete !== true || target.coverage.rows !== 1 || target.payload?.reference_type !== 'OFFICIAL_TARGET' ||
                !Number.isFinite(target.payload?.value) || target.payload.value < 0) fail('INCOMPATIBLE_ATTAINMENT_TARGET');
            evidence.push(target);
            const refs = { observed: observed.evidence_id, reference: target.evidence_id };
            const meta = target.payload.value, gap = value - meta, zero = meta === 0;
            // Preserve deviation fields for consumers; this arithmetic is local, not a P2 execution.
            const r = { observed_value: value, reference_value: meta, absolute_deviation: gap,
              relative_deviation: zero ? null : gap / meta, relative_deviation_status: zero ? 'ZERO_REFERENCE' : 'CALCULATED',
              direction: gap > 0 ? 'ABOVE_REFERENCE' : gap < 0 ? 'BELOW_REFERENCE' : 'ON_REFERENCE',
              reference_type: target.payload.reference_type, reference_source: target.payload.source ?? null };
            const lineage = { calculation: 'LOCAL_ATTAINMENT', run_id,
              evidence_refs: Object.entries(refs).map(([slot, evidence_id]) => ({ slot, evidence_id,
                ...(grouped && slot === 'observed' ? { evidence_contract: observed.evidence_contract, member_id: dimension_id } : {}) })) };
            Object.assign(result, { status: zero ? 'ZERO_TARGET' : 'CALCULATED', target_vin: r.reference_value,
              attainment_percent: zero ? null : value / meta * 100,
              gap_vin: r.absolute_deviation, target_evidence_id: target.evidence_id, deviation: r, lineage });
          }
        }
        // gap_vin is signed SALES minus the official TARGET.
        rows.push({ dimension, dimension_id, payload: { attainment: result } });
      }
      return { run_id, period: period + '-01', cutoff_date, rows, evidence,
        coverage: { COMPANY: 'UNSUPPORTED_BY_TARGETS_P1', DEALERS: 'UNSUPPORTED_BY_TARGETS_P1', STORE: 'PER_STORE_OFFICIAL_REFERENCE' },
        sources: { attainment: { evidence_ids: evidence.map(e => e.evidence_id), calculation: 'LOCAL_ATTAINMENT' } } };
    });
  };
}
