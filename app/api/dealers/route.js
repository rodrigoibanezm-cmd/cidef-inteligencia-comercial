import { db } from '../../../lib/db.js';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request) {
  const year = new URL(request.url).searchParams.get('year');
  if (!/^20[2-9][0-9]$/.test(year || '')) return json({ error: 'INVALID_YEAR' }, 400);
  try {
    const sql = db();
    const rows = await sql.query(`SELECT period, dealer_group_id, foton_units, dongfeng_units,
      cutoff_date::text AS cutoff, sales_evidence_id
      FROM dealer_monthly_sellin_snapshots
      WHERE period BETWEEN $1 AND $2 ORDER BY dealer_group_id, period`, [year + '-01', year + '-12']);
    if (!rows.length) return json({ error: 'SNAPSHOT_NOT_AVAILABLE' }, 404);
    const names = await sql.query(`SELECT to_jsonb(g) AS item FROM dealer_groups g`);
    const namesById = new Map(names.map(({ item }) => [String(item.dealer_group_id ?? item.id), item.nombre_canonico ?? item.nombre ?? item.name]).filter(([id, name]) => id && name));
    const dealers = new Map(); let cutoff = ''; let evidenceId = '';
    for (const r of rows) {
      if (!r.sales_evidence_id || !Number.isInteger(r.foton_units) || !Number.isInteger(r.dongfeng_units)) return json({ error: 'SNAPSHOT_INVALID' }, 503);
      if (evidenceId && evidenceId !== r.sales_evidence_id) return json({ error: 'SNAPSHOT_EVIDENCE_MISMATCH' }, 503);
      evidenceId = r.sales_evidence_id;
      if (r.cutoff > cutoff) cutoff = r.cutoff;
      const id = String(r.dealer_group_id);
      if (!dealers.has(id)) dealers.set(id, { id, name: id === '0' ? 'Sin dealer identificado' : namesById.get(id) || 'Dealer ' + id,
        brands: { FOTON: Array(12).fill(0), DONGFENG: Array(12).fill(0) } });
      const index = Number(r.period.slice(-2)) - 1;
      if (index < 0 || index > 11) return json({ error: 'SNAPSHOT_INVALID_MONTH' }, 503);
      dealers.get(id).brands.FOTON[index] = r.foton_units;
      dealers.get(id).brands.DONGFENG[index] = r.dongfeng_units;
    }
    return json({ certified: true, source: 'SALES', year: Number(year), cutoff, evidence_id: evidenceId, dealers: [...dealers.values()] });
  } catch (error) { console.error('DEALERS_SNAPSHOT_READ_FAILED', error); return json({ error: 'SNAPSHOT_READ_FAILED' }, 503); }
}
