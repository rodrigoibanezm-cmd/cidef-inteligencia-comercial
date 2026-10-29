import { withP1Mcp as defaultConnect, callP1 as defaultCall } from './p1-client.js';
import { createMonthlyCloseTrackingSource } from './monthly-close-tracking-source.js';
import { createMonthlyCloseTrackingYoy } from './monthly-close-tracking-yoy.js';
import { createMonthlyCloseTrackingAttainment } from './monthly-close-tracking-attainment.js';
import { createMonthlyCloseTrackingRhythm } from './monthly-close-tracking-rhythm.js';
import { createMonthlyCloseTrackingStore } from './monthly-close-tracking-store.js';

const key = row => JSON.stringify([row.dimension, row.dimension_id]);
const fail = message => { throw new Error(message); };
// Canonical request identity; cache only within one generation and preserve original evidence.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;

export function createMonthlyCloseTrackingGenerator({ withP1Mcp = defaultConnect, callP1 = defaultCall,
  store = createMonthlyCloseTrackingStore() } = {}) {
  return async function generate({ run_id, period, cutoff_date, store_ids, cutoff_at,
    cutoff_timezone = 'America/Santiago', engine_version, environment = 'staging' }) {
    if (environment !== 'staging') fail('STAGING_ONLY');
    return withP1Mcp(async client => {
      const cache = new Map();
      const sharedCall = (connection, name, args) => {
        const id = JSON.stringify(canonical({ name, args }));
        if (!cache.has(id)) cache.set(id, Promise.resolve().then(() => callP1(connection, name, args)));
        return cache.get(id);
      };
      const deps = { withP1Mcp: callback => callback(client), callP1: sharedCall };
      const sales = await createMonthlyCloseTrackingSource(deps)({ run_id, period, cutoff_date, store_ids });
      // SALES may discover active stores beyond the supplied roster: use its complete member set.
      const ids = sales.expected_members.filter(row => row.dimension === 'STORE').map(row => row.dimension_id);
      const input = { run_id, period, cutoff_date, store_ids: ids };
      // Two independent helper chains, each issuing one awaited call at a time:
      // at most two remote requests share this connection and in-flight cache.
      // Drain both chains on failure before withP1Mcp closes the shared client.
      const results = await Promise.allSettled([
        createMonthlyCloseTrackingYoy(deps)({ ...input, sales }), createMonthlyCloseTrackingRhythm(deps)({ ...input, sales }),
      ]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      const [yoy, rhythm] = results.map(result => result.value);
      const storeEvidence = sales.evidence.find(e => e.evidence_contract === 'p1.dimensional_quantitative_dataset' &&
        e.universe?.commercial_universe === 'OWN_STORES' && e.payload?.dimension?.id === 'STORE');
      const observations = [];
      for (const { dimension, dimension_id } of sales.expected_members) {
        // STORE members retain the original shared block; only COMPANY/DEALERS need cumulative scalars.
        const evidence = dimension === 'STORE' ? storeEvidence : await sharedCall(client, 'data_observe', { run_id, source: 'SALES', measure: 'VIN_SALES',
          evidence_shape: 'CUMULATIVE_PERIOD_OBSERVATION', period, cutoff: cutoff_date,
          filters: { commercial_universe: dimension } });
        observations.push({ dimension, dimension_id, evidence });
      }
      const attainment = await createMonthlyCloseTrackingAttainment(deps)({ run_id, period, cutoff_date, sales: observations });
      const expected = new Set(sales.expected_members.map(key));
      const indexes = [sales, yoy, attainment, rhythm].map(result => {
        const index = new Map(result.rows.map(row => [key(row), row]));
        if (result.run_id !== run_id || result.period !== period + '-01' || result.cutoff_date !== cutoff_date ||
            index.size !== result.rows.length || index.size !== expected.size || [...index.keys()].some(k => !expected.has(k)))
          fail('INCOMPLETE_GENERATOR_DIMENSIONS');
        return index;
      });
      const rows = sales.expected_members.map(member => {
        const [s, y, a, r] = indexes.map(index => index.get(key(member)).payload);
        const observed = observations.find(row => key(row) === key(member)).evidence;
        if (s.sales_mtd.value !== y.yoy.comparison_value || s.sales_mtd.value !== a.attainment.sales_vin ||
            observed.temporal.date_from !== s.date_from || y.yoy.comparison.date_from !== s.date_from ||
            (member.dimension === 'STORE' && (s.sales_mtd.evidence_id !== observed.evidence_id ||
              y.yoy.comparison.evidence_id !== observed.evidence_id || y.yoy.comparison.member_id !== member.dimension_id ||
              a.attainment.sales_evidence_id !== observed.evidence_id ||
              r.rhythm.current.sales_vin !== s.sales_mtd.value ||
              r.rhythm.current.sales_evidence_id !== a.attainment.sales_evidence_id ||
              r.rhythm.current.target_evidence_id !== a.attainment.target_evidence_id ||
              r.rhythm.current.attainment_percent !== a.attainment.attainment_percent))) fail('INCONSISTENT_CURRENT_EVIDENCE');
        return { ...member, payload: { ...s, ...y, ...a, ...r } };
      });
      const evidence = [...new Map([sales, yoy, attainment, rhythm].flatMap(result => result.evidence)
        .map(e => [e.evidence_id, e])).values()];
      const snapshot = { environment, period: sales.period, cutoff_date, cutoff_at, cutoff_timezone,
        engine_version, expected_members: sales.expected_members, rows, sources: { run_id,
          ...sales.sources, ...yoy.sources, ...attainment.sources, ...rhythm.sources, evidence,
          coverage: attainment.coverage, commercial_day: rhythm.commercial_day } };
      // The existing publisher owns validation, the transaction, lock and generation_id.
      const publication = await store.publish(snapshot);
      return { snapshot, publication };
    });
  };
}
