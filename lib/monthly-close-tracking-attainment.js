import { withP1Mcp as defaultConnect, callP1 as defaultCall } from './p1-client.js';

const UNIT = 'p2.reference_deviation', VERSION = '0.1.0';
const fail = message => { throw new Error(message); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const identity = (e, source, contract) => e?.source === source && e.authority === 'P1_CERTIFIED' &&
  e.status === 'CERTIFIED' && e.evidence_id && e.evidence_version && e.lineage && e.evidence_contract === contract;

// sales: [{ dimension, dimension_id, evidence }], with original cumulative P1 evidence from run_id.
export function createMonthlyCloseTrackingAttainment({ withP1Mcp = defaultConnect, callP1 = defaultCall } = {}) {
  return async function load({ run_id, period, cutoff_date, sales }) {
    if (typeof run_id !== 'string' || !run_id.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !date(cutoff_date) || !Array.isArray(sales) || !sales.length) fail('INVALID_ATTAINMENT_INPUT');
    const keys = new Set();
    for (const { dimension, dimension_id, evidence: e } of sales) {
      const universe = { COMPANY: 'COMPANY', DEALERS: 'DEALERS', STORE: 'OWN_STORES' }[dimension];
      const dimensions = dimension === 'STORE' ? { store_id: dimension_id } : {};
      const key = JSON.stringify([dimension, dimension_id]);
      if (!universe || typeof dimension_id !== 'string' || !dimension_id.trim() || dimension_id !== dimension_id.trim() ||
          dimension_id === 'UNRESOLVED' || (dimension !== 'STORE' && dimension_id !== 'ALL') || keys.has(key) ||
          !identity(e, 'SALES', 'p1.cumulative_period_observation') || e.grain !== 'FILTERED_SALES_UNIVERSE' ||
          e.measure?.id !== 'VIN_SALES' || e.measure.unit !== 'VIN' || e.measure.aggregation !== 'COUNT_RECOGNIZED_SALE' ||
          JSON.stringify(e.universe) !== JSON.stringify({ commercial_universe: universe }) ||
          JSON.stringify(e.dimensions) !== JSON.stringify(dimensions) || e.temporal?.period_identity !== period ||
          e.temporal.period_type !== 'COMMERCIAL_MONTH' || e.temporal.cutoff !== cutoff_date ||
          e.temporal.date_to !== cutoff_date || e.temporal.date_semantics !== 'fecha_factura' ||
          !date(e.temporal.date_from) || e.temporal.date_from > cutoff_date || !count(e.payload?.observed_value) ||
          e.coverage?.filtered_n !== e.payload.observed_value || !count(e.coverage?.source_n) ||
          e.coverage.source_n < e.coverage.filtered_n) fail('INCOMPATIBLE_ATTAINMENT_SALES');
      keys.add(key);
    }
    return withP1Mcp(async client => {
      const rows = [], evidence = sales.map(row => row.evidence), call = (name, args) => callP1(client, name, { run_id, ...args });
      for (const { dimension, dimension_id, evidence: observed } of sales) {
        const result = { status: 'UNSUPPORTED_TARGET_SCOPE', period, cutoff_date,
          commercial_universe: observed.universe.commercial_universe, sales_vin: observed.payload.observed_value,
          target_vin: null, attainment_percent: null, gap_vin: null,
          sales_evidence_id: observed.evidence_id, target_evidence_id: null, lineage: null };
        if (dimension === 'STORE') {
          let target;
          try { target = await call('data_observe', { source: 'TARGETS', measure: 'VIN_TARGET',
            evidence_shape: 'REFERENCE_OBSERVATION', period, filters: { store_id: dimension_id } }); }
          catch (error) { if (!/\bTARGET_REFERENCE_NOT_FOUND\b/.test(error?.message || '')) throw error; }
          result.status = target == null ? 'TARGET_NOT_FOUND' : 'UNCERTIFIED_TARGET';
          if (target?.authority === 'P1_CERTIFIED' && target.status === 'CERTIFIED') {
            if (!identity(target, 'TARGETS', 'p1.reference_observation') || target.grain !== 'STORE_MONTH' ||
                target.measure?.id !== 'VIN_TARGET' || target.measure.unit !== 'VIN' || target.measure.aggregation !== 'EXPLICIT_TARGET' ||
                JSON.stringify(target.universe) !== JSON.stringify(observed.universe) ||
                JSON.stringify(target.dimensions) !== JSON.stringify(observed.dimensions) || target.temporal?.period_identity !== period ||
                target.coverage?.complete !== true || target.coverage.rows !== 1 || target.payload?.reference_type !== 'OFFICIAL_TARGET' ||
                !Number.isFinite(target.payload?.value) || target.payload.value < 0) fail('INCOMPATIBLE_ATTAINMENT_TARGET');
            evidence.push(target);
            const refs = { observed: observed.evidence_id, reference: target.evidence_id };
            const p2 = await call('p2_execute', { unit_id: UNIT, contract_version: VERSION, evidence: refs });
            const r = p2?.result, lineage = p2?.lineage, zero = target.payload.value === 0;
            if (p2?.status !== 'EXECUTED' || lineage?.unit_id !== UNIT || lineage.contract_version !== VERSION ||
                lineage.run_id !== run_id || !lineage.execution_id || !Array.isArray(lineage.evidence_refs) ||
                lineage.evidence_refs.length !== 2 || Object.entries(refs).some(([slot, id]) =>
                  !lineage.evidence_refs.some(e => e.slot === slot && e.evidence_id === id)) ||
                r?.observed_value !== observed.payload.observed_value || r?.reference_value !== target.payload.value ||
                !Number.isFinite(r?.absolute_deviation) || !['ABOVE_REFERENCE', 'BELOW_REFERENCE', 'ON_REFERENCE'].includes(r.direction) ||
                (zero ? r.relative_deviation !== null || r.relative_deviation_status !== 'ZERO_REFERENCE' :
                  !Number.isFinite(r.relative_deviation) || r.relative_deviation_status !== 'CALCULATED')) fail('INVALID_ATTAINMENT_P2');
            Object.assign(result, { status: zero ? 'ZERO_TARGET' : 'CALCULATED', target_vin: r.reference_value,
              attainment_percent: zero ? null : (1 + r.relative_deviation) * 100,
              gap_vin: r.absolute_deviation, target_evidence_id: target.evidence_id, deviation: r, lineage });
          }
        }
        // gap_vin is signed SALES minus TARGET, exactly as returned by P2.
        rows.push({ dimension, dimension_id, payload: { attainment: result } });
      }
      return { run_id, period: period + '-01', cutoff_date, rows, evidence,
        coverage: { COMPANY: 'UNSUPPORTED_BY_TARGETS_P1', DEALERS: 'UNSUPPORTED_BY_TARGETS_P1', STORE: 'PER_STORE_OFFICIAL_REFERENCE' },
        sources: { attainment: { evidence_ids: evidence.map(e => e.evidence_id), p2_unit: UNIT, p2_version: VERSION } } };
    });
  };
}
