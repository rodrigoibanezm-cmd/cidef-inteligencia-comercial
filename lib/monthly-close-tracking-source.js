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

// P1 owns recognition/certification; this helper distributes its complete results.
// Daily values describe sale dates as recognized at cutoff_date, not archived daily cuts.
export function createMonthlyCloseTrackingSource({ withP1Mcp = defaultConnect, callP1 = defaultCall } = {}) {
  return async function load({ run_id, period, cutoff_date, store_ids }) {
    if (typeof run_id !== 'string' || !run_id.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !date(cutoff_date) || !Array.isArray(store_ids) || !store_ids.length ||
        store_ids.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id === 'UNRESOLVED') ||
        new Set(store_ids).size !== store_ids.length) throw new Error('INVALID_SALES_SOURCE_INPUT');
    return withP1Mcp(async client => {
      const call = (name, args) => callP1(client, name, { run_id, ...args });
      const calendar = await call('data_observe', { source: 'SALES', measure: 'VIN_SALES', evidence_shape: 'PERIOD_CALENDAR', period });
      const days = calendar?.payload?.eligible_observation_days;
      if (!calendar?.evidence_id || calendar.temporal?.period_identity !== period ||
          !Array.isArray(days) || !days.length || !days.includes(cutoff_date)) fail();
      const evidence = [calendar], accumulated = [], details = [], datasets = [];
      let storeMembers = [], own_stores_total;
      for (const universe of ['COMPANY', 'DEALERS', 'OWN_STORES']) {
        const grouped = universe === 'OWN_STORES';
        const block = await call('sales_observe_many', { period, cutoff: cutoff_date, commercial_universe: universe,
          operations: grouped ? [{ kind: 'TOTAL' }, { kind: 'STORE' }] : [{ kind: 'TOTAL' }] });
        if (block?.source !== 'SALES' || block.period !== period || block.cutoff !== cutoff_date ||
            block.commercial_universe !== universe || !Array.isArray(block.results)) fail();
        const total = block.results.find(r => r.operation?.kind === 'TOTAL')?.evidence;
        const groupedEvidence = block.results.find(r => r.operation?.kind === 'STORE')?.evidence;
        const selected = grouped ? groupedEvidence : total;
        if (!total?.evidence_id || !count(total.payload?.value) || !selected?.evidence_id ||
            selected.universe?.commercial_universe !== universe || selected.temporal?.date_from !== days[0] ||
            selected.temporal?.date_to !== cutoff_date) fail();
        if (grouped) {
          storeMembers = selected.payload?.members;
          if (!Array.isArray(storeMembers) || selected.payload.dimension?.id !== 'STORE' ||
              selected.coverage?.dimension_unresolved_n !== 0 ||
              storeMembers.some(m => !m.member_id || m.member_id === 'UNRESOLVED' || !count(m.value)) ||
              new Set(storeMembers.map(m => m.member_id)).size !== storeMembers.length ||
              storeMembers.reduce((sum, m) => sum + m.value, 0) !== total.payload.value) fail();
          own_stores_total = total.payload.value;
        }
        evidence.push(total, ...(grouped ? [selected] : [])); accumulated.push(selected);
        const filters = { commercial_universe: universe, date_from: days[0], date_to: cutoff_date };
        const work = await call('data_fetch', { source: 'SALES', filters, fields: ['vin', 'sale_date', 'store_id'] });
        // Same complete SALES_WORK projection as Proyecciones Admin. Check capture parity,
        // not commercial recognition: a missing/truncated or changed capture is not zero sales.
        if (work?.source !== 'SALES' || work.dataset !== 'SALES_WORK' || work.grain !== 'RECOGNIZED_SALE' ||
            !Array.isArray(work.rows) || work.size?.filtered_n !== work.rows.length ||
            work.rows.length !== total.payload.value) fail();
        const byDay = new Map(), byStore = new Map();
        for (const row of work.rows) {
          if (!row.vin || !date(row.sale_date) || row.sale_date < days[0] || row.sale_date > cutoff_date ||
              (grouped && (typeof row.store_id !== 'string' && typeof row.store_id !== 'number'))) fail();
          const id = grouped ? String(row.store_id) : 'ALL', key = JSON.stringify([row.sale_date, id]);
          byDay.set(key, (byDay.get(key) || 0) + 1); byStore.set(id, (byStore.get(id) || 0) + 1);
        }
        if (grouped && (byStore.size !== storeMembers.length ||
            storeMembers.some(m => byStore.get(String(m.member_id)) !== m.value))) fail();
        details.push(byDay);
        datasets.push({ commercial_universe: universe, dataset: work.dataset, version: work.version,
          filters, evidence_id: selected.evidence_id });
      }
      const monday = shift(cutoff_date, -((new Date(cutoff_date + 'T12:00:00Z').getUTCDay() + 6) % 7));
      const daily = Array.from({ length: 6 }, (_, i) => {
        const day = shift(monday, i);
        return { date: day, status: !days.includes(day) ? 'OUTSIDE_PERIOD' : day > cutoff_date ? 'AFTER_CUTOFF' : 'OBSERVED' };
      });
      const ids = [...new Set([...store_ids, ...storeMembers.map(m => String(m.member_id))])];
      const scopes = [['COMPANY', 'ALL', 0], ['DEALERS', 'ALL', 1], ...ids.map(id => ['STORE', id, 2])];
      const rows = scopes.map(([dimension, dimension_id, index]) => ({ dimension, dimension_id, payload: {
        commercial_universe: ['COMPANY', 'DEALERS', 'OWN_STORES'][index], date_from: days[0], cutoff_date,
        sales_mtd: { value: index < 2 ? accumulated[index].payload.value :
          storeMembers.find(m => String(m.member_id) === dimension_id)?.value ?? 0, evidence_id: accumulated[index].evidence_id },
        daily: daily.map(d => ({ ...d, value: d.status === 'OBSERVED' ? details[index].get(JSON.stringify([d.date, dimension_id])) ?? 0 : null,
          // Reference to the original period dataset; never a fabricated daily/scalar evidence.
          evidence_id: d.status === 'OBSERVED' ? accumulated[index].evidence_id : null })),
      } }));
      return { run_id, period: period + '-01', cutoff_date, week_start: monday, rows,
        expected_members: rows.map(({ dimension, dimension_id }) => ({ dimension, dimension_id })), own_stores_total,
        sources: { sales: { calendar_evidence_id: calendar.evidence_id, evidence_ids: evidence.map(e => e.evidence_id),
          daily_basis: 'SALES_WORK_AT_CUTOFF', datasets } }, evidence };
    });
  };
}
