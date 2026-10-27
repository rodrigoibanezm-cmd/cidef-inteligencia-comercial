import { MONTHS, POLICY, rankPerformance, VERSION } from './motors/ranking-performance-v1.js';

// Adapt P1 UFIs to the existing ranking contract; keep its policy and engine unchanged.
// The engine's historical `vin` field carries UFI units only inside this adapter/result.
export function buildForumRanking(source) {
  if (source?.status !== 'CERTIFIED' || source.authority !== 'P1_CERTIFIED' ||
    source.source !== 'FORUM' || source.measure !== 'UFIS' || source.network !== 'OWN_STORES' ||
    source.date_axis !== 'fecha_curse' || JSON.stringify(source.months) !== JSON.stringify(MONTHS)) return null;
  const datasets = MONTHS.map(month => source.datasets?.[month]);
  if (datasets.some((set, i) => set?.status !== 'CERTIFIED' || set.authority !== 'P1_CERTIFIED' ||
    set.source !== 'FORUM' || set.measure !== 'UFIS' || set.unit !== 'VEHICLE_UNIT' ||
    set.network !== 'OWN_STORES' || set.period !== MONTHS[i] ||
    set.cutoff !== ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'][i] ||
    !set.evidence_id || !set.evidence_ref || !set.observed_at ||
    set.identity_contract !== 'store_v01' || set.rule !== 'CURSE_VEHICLE_UNITS_BY_FECHA_CURSE' ||
    !Array.isArray(set.members) || new Set(set.members.map(row => row.member_id)).size !== set.members.length ||
    set.members.some(row => typeof row.member_id !== 'string' || !row.member_id || !row.member_label || !Number.isInteger(row.value) || row.value < 0))) return null;
  const members = new Map(datasets.flatMap(set => set.members.map(row => [row.member_id, row.member_label])));
  const records = [], incomplete = [], unresolved = [];
  for (const [id, name] of members) {
    if (id.startsWith('UNRESOLVED:')) { unresolved.push({ id, name }); continue; }
    const points = datasets.map(set => set.members.find(row => row.member_id === id));
    if (points.some(point => !point)) {
      incomplete.push({ id, name, missing_months: MONTHS.filter((_, i) => !points[i]) });
      continue;
    }
    records.push({ id, name, months: Object.fromEntries(MONTHS.map((month, i) => [month, points[i].value])) });
  }
  return { ...rankPerformance(records), incomplete, unresolved, months: MONTHS, policy: POLICY,
    motor_version: VERSION, source: 'FORUM P1', unit: 'UFI', observed_at: source.observed_at,
    evidence_refs: datasets.map(set => set.evidence_ref) };
}
