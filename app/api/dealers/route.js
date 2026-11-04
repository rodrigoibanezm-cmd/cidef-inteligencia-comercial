import { db } from '../../../lib/db.js';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request) {
  const year = new URL(request.url).searchParams.get('year');
  if (!['2025', '2026'].includes(year)) return json({ error: 'INVALID_YEAR' }, 400);
  try {
    const sql = db();
    const rows = await sql.query(`SELECT period, dealer_group_id, brand_id, model_id, vin_sales,
      cutoff_date::text AS cutoff, sales_evidence_id
      FROM dealer_monthly_model_sellin_snapshots
      WHERE period BETWEEN $1 AND $2 ORDER BY dealer_group_id, period`, [year + '-01', year + '-12']);
    if (!rows.length) return json({ error: 'SNAPSHOT_NOT_AVAILABLE' }, 404);
    const selloutRows = await sql.query(`SELECT to_char(v.fecha_inscripcion_rvm,'YYYY-MM') AS period,
      v.dealer_group_id, ver.modelo_id::text AS model_id, COUNT(DISTINCT v.vin)::int AS units
      FROM vehiculo_canonico v
      JOIN versiones_master_v01 ver ON ver.version_id = v.version_id
      WHERE v.fecha_inscripcion_rvm >= $1::date
        AND v.fecha_inscripcion_rvm < ($2::date + interval '1 month')
        AND v.vendido = true AND v.es_tienda_propia = false
        AND v.dealer_group_id IS NOT NULL AND v.vin IS NOT NULL
      GROUP BY 1, 2, 3`, [year + '-01-01', year + '-12-01']);
    const [names, models] = await Promise.all([
      sql.query('SELECT to_jsonb(g) AS item FROM dealer_groups g'),
      sql.query('SELECT modelo_id::text AS id, nombre_canonico AS name FROM modelos_master_v01'),
    ]);
    const namesById = new Map(names.map(({ item }) => [String(item.dealer_group_id ?? item.id), item.nombre_canonico ?? item.nombre ?? item.name]).filter(([id, name]) => id && name));
    const modelNames = new Map(models.map(r => [String(r.id), r.name]));
    const dealers = new Map(), modelList = new Map(), evidence = {};
    let cutoff = '';
    for (const r of rows) {
      const brand = String(r.brand_id) === '89' ? 'FOTON' : String(r.brand_id) === '71' ? 'DONGFENG' : null;
      const month = Number(r.period.slice(-2)) - 1;
      if (!brand || !Number.isInteger(r.vin_sales) || r.vin_sales < 0 ||
        month < 0 || month > 11 || !r.sales_evidence_id) return json({ error: 'SNAPSHOT_INVALID' }, 503);
      if (evidence[r.period] && evidence[r.period] !== r.sales_evidence_id) return json({ error: 'SNAPSHOT_EVIDENCE_MISMATCH' }, 503);
      evidence[r.period] = r.sales_evidence_id;
      if (r.cutoff > cutoff) cutoff = r.cutoff;
      const id = String(r.dealer_group_id), modelId = String(r.model_id);
      if (!dealers.has(id)) dealers.set(id, {
        id, name: id === '0' ? 'Sin dealer identificado' : namesById.get(id) || 'Dealer ' + id,
        brands: { FOTON: Array(12).fill(0), DONGFENG: Array(12).fill(0) }, models: {},
        sellout: { FOTON: Array(12).fill(0), DONGFENG: Array(12).fill(0), models: {} },
      });
      const dealer = dealers.get(id);
      dealer.brands[brand][month] += r.vin_sales;
      if (!dealer.models[modelId]) dealer.models[modelId] = Array(12).fill(0);
      dealer.models[modelId][month] += r.vin_sales;
      modelList.set(modelId, { id: modelId, name: modelNames.get(modelId) || 'Modelo ' + modelId, brand });
    }
    for (const r of selloutRows) {
      const dealer = dealers.get(String(r.dealer_group_id));
      if (!dealer) continue;
      const modelId = String(r.model_id), model = modelList.get(modelId);
      if (!model) continue;
      const month = Number(r.period.slice(-2)) - 1;
      if (month < 0 || month > 11) continue;
      dealer.sellout[model.brand][month] += r.units;
      if (!dealer.sellout.models[modelId]) dealer.sellout.models[modelId] = Array(12).fill(0);
      dealer.sellout.models[modelId][month] += r.units;
    }
    return json({ certified: true, source: 'SALES', year: Number(year), cutoff,
      evidence_id: evidence[Object.keys(evidence).sort().at(-1)],
      evidence_by_period: evidence, models: [...modelList.values()].sort((a,b) => a.name.localeCompare(b.name, 'es')),
      dealers: [...dealers.values()] });
  } catch (error) { console.error('DEALERS_SNAPSHOT_READ_FAILED', error); return json({ error: 'SNAPSHOT_READ_FAILED' }, 503); }
}
