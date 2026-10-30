import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createMonthlyCloseTrackingStore } from '../../../lib/monthly-close-tracking-store.js';
import { createMonthlyCloseTrackingGenerator } from '../../../lib/monthly-close-tracking-generator.js';
import { GET as getBranches } from '../weekly-projections/sucursales/route.js';
import { GET as getProjections } from '../weekly-projections/projections/route.js';
import { GET as getNotInvoiced } from '../weekly-projections/not-invoiced/route.js';
import { db } from '../../../lib/db.js';
import { withP1Mcp, callP1 } from '../../../lib/p1-client.js';

export const dynamic = 'force-dynamic';
const store = createMonthlyCloseTrackingStore();
const generate = createMonthlyCloseTrackingGenerator({ store });
const TIMEZONE = 'America/Santiago', VERSION = 'monthly-close-tracking-v1';
// Same access model as Proyecciones Admin. Per-user authorization is not implemented;
// resolve it before enabling broader access. No new authentication mechanism here.
const bad = (error, status = 400) => NextResponse.json({ ok: false, error }, { status });
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
function environment() {
  const value = String(process.env.PROJECTIONS_ENVIRONMENT || 'staging').trim().toLowerCase();
  if (!['staging', 'production'].includes(value)) throw new Error('INVALID_ENVIRONMENT');
  return value;
}
function dates({ period, cutoff_date }) {
  if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) invalid('INVALID_PERIOD');
  if (typeof cutoff_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff_date) ||
      !Number.isFinite(Date.parse(cutoff_date)) || new Date(cutoff_date).toISOString().slice(0, 10) !== cutoff_date)
    invalid('INVALID_CUTOFF_DATE');
  return { period, cutoff_date };
}

// Presentation only: reuse the saved Proyecciones detail and the Dealers identity.
// Monthly dealer snapshots cannot supply daily dates; fetch their existing SALES_WORK fields.
async function dailyTables(period, cutoff_date, env, origin) {
  if (env !== 'staging') return bad('STAGING_ONLY', 403);
  if (period !== '2026-10' || cutoff_date < '2026-10-26' || cutoff_date > '2026-10-31')
    invalid('UNSUPPORTED_DAILY_CUT');
  const response = await getBranches(), catalog = await response.json();
  if (!response.ok || catalog?.ok !== true || !Array.isArray(catalog.sucursales) || !catalog.sucursales.length)
    throw new Error('INCOMPLETE_STORE_CATALOG');
  const sql = db();
  const saved = await sql.query(`SELECT payload, updated_at::text FROM weekly_projection_results
    WHERE week_start=$1::date AND cutoff_date=$2::date AND environment=$3 AND scope_key='COMPANY'`,
  ['2026-10-26', cutoff_date, env]);
  if (!saved.length) return bad('PROJECTIONS_SNAPSHOT_NOT_FOUND', 404);
  const sales = saved[0].payload?.admin?.sales_mtd;
  if (saved.length !== 1 || sales?.date_from !== '2026-10-01' || sales?.cutoff_date !== cutoff_date ||
      !Array.isArray(sales.details) || sales.total_units !== sales.details.length)
    throw new Error('INCOMPLETE_PROJECTIONS_DETAIL');
  const names = await sql.query(`SELECT to_jsonb(g) AS item FROM dealer_groups g
    WHERE EXISTS (SELECT 1 FROM dealer_monthly_sellin_snapshots s
      WHERE s.period=$1 AND s.dealer_group_id::text=COALESCE(to_jsonb(g)->>'dealer_group_id',to_jsonb(g)->>'id')
      GROUP BY s.dealer_group_id
      HAVING SUM(COALESCE(s.foton_units,0)+COALESCE(s.dongfeng_units,0))>0)`, ['2026-09']);
  const dealerCatalog = names.map(({ item }) => ({ id: String(item.dealer_group_id ?? item.id ?? ''),
    name: item.nombre_canonico ?? item.nombre ?? item.name }));
  const stores = catalog.sucursales.map(s => ({ id: String(s.sucursal_id ?? ''), name: s.nombre_canonico }));
  const index = entries => {
    if (!entries.length || entries.some(r => !/^\d+$/.test(r.id) || typeof r.name !== 'string' || !r.name.trim()) ||
        new Set(entries.map(r => r.id)).size !== entries.length) throw new Error('INVALID_DAILY_CATALOG');
    return new Map(entries.map(r => [r.id, { ...r, monday: 0,
      daily: Array.from({ length: 5 }, (_, i) => ({ date: '2026-10-' + (27 + i),
        value: '2026-10-' + (27 + i) <= cutoff_date ? 0 : null })), total: 0 }]));
  };
  const own = index(stores), dealers = dealerCatalog.length ? index(dealerCatalog) : new Map();
  const add = (map, id, name, day) => {
    if (typeof day !== 'string' || !/^2026-10-(0[1-9]|[12][0-9]|3[01])$/.test(day) || day > cutoff_date)
      throw new Error('INVALID_DAILY_SALE_DATE');
    if (!map.has(id)) {
      if (!/^\d+$/.test(id) || typeof name !== 'string' || !name.trim()) throw new Error('UNRESOLVED_DAILY_IDENTITY');
      map.set(id, index([{ id, name }]).get(id));
    }
    const row = map.get(id);
    if (day <= '2026-10-26') row.monday++;
    else row.daily.find(d => d.date === day).value++;
    row.total++;
  };
  for (const sale of sales.details) add(own, String(sale.sucursal_id ?? ''), sale.sucursal, sale.fecha_venta);
  // Already grouped from certified brand IDs by Proyecciones; no second OWN_STORES fetch.
  const brands = saved[0].payload.admin.brand_indicators?.sales;
  const units = value => Number.isSafeInteger(value) && value >= 0;
  if (brands?.source !== 'SALES P1' || brands.source_dataset !== 'SALES_WORK' || brands.cutoff !== cutoff_date ||
      !Array.isArray(brands.evidence_ids) || !brands.evidence_ids.length ||
      ![brands.company, brands.foton, brands.dongfeng].every(units) ||
      brands.company !== sales.total_units || brands.foton + brands.dongfeng > brands.company)
    throw new Error('INCOMPLETE_OR_INCOMPATIBLE_STORE_BRANDS');
  const summary = { stores: { total: brands.company, foton: brands.foton, dongfeng: brands.dongfeng,
    unidentified: brands.company - brands.foton - brands.dongfeng },
    dealers: { total: 0, foton: 0, dongfeng: 0, unidentified: 0 } };
  const uniqueVins = rows => {
    const vins = rows.map(row => String(row.vin ?? '').trim().toUpperCase()).filter(Boolean);
    if (new Set(vins).size !== vins.length) throw new Error('DUPLICATE_SALES_VIN');
  };
  uniqueVins(sales.details);
  const run_id = randomUUID();
  const [work, ownWork] = await withP1Mcp(client => Promise.all([
    callP1(client, 'data_fetch', { run_id, source: 'SALES',
      filters: { commercial_universe: 'DEALERS', date_from: '2026-10-01', date_to: cutoff_date },
      fields: ['vin', 'sale_date', 'dealer_group_id', 'brand_id', 'model_id'] }),
    callP1(client, 'data_fetch', { run_id, source: 'SALES',
      filters: { commercial_universe: 'OWN_STORES', date_from: '2026-10-01', date_to: cutoff_date },
      fields: ['vin', 'sale_date', 'brand_id', 'model_id'] }),
  ]));
  if (work?.source !== 'SALES' || work.dataset !== 'SALES_WORK' || work.grain !== 'RECOGNIZED_SALE' ||
      !Array.isArray(work.rows) || work.size?.filtered_n !== work.rows.length)
    throw new Error('INCOMPLETE_DEALER_DETAIL');
  uniqueVins(work.rows);
  if (ownWork?.source !== 'SALES' || ownWork.dataset !== 'SALES_WORK' ||
      ownWork.grain !== 'RECOGNIZED_SALE' || !Array.isArray(ownWork.rows) ||
      ownWork.size?.filtered_n !== ownWork.rows.length || ownWork.rows.length !== sales.details.length)
    throw new Error('INCOMPLETE_STORE_MODEL_DETAIL');
  uniqueVins(ownWork.rows);
  const savedVins = new Set(sales.details.map(row => String(row.vin).trim().toUpperCase()));
  if (ownWork.rows.some(row => !savedVins.has(String(row.vin).trim().toUpperCase())))
    throw new Error('STORE_MODEL_SNAPSHOT_PARITY_FAILED');
  const catalogRows = await sql.query(`SELECT m.modelo_id::text, m.marca_id::text, m.nombre_canonico AS modelo,
    m.familia, ma.nombre_canonico AS marca
    FROM modelos_master_v01 m JOIN marcas_master_v01 ma USING (marca_id)
    WHERE m.marca_id IN (71,89)`);
  const catalogByModel = new Map(catalogRows.map(row => [row.modelo_id, row]));
  const groups = new Map();
  const group = (channel, brandId, modelId) => {
    const model = catalogByModel.get(String(modelId ?? ''));
    if (!model || model.marca_id !== String(brandId)) throw new Error('UNRESOLVED_MODEL_CATALOG');
    // Foton's COMERCIAL family includes both mini trucks and passenger vehicles.
    const family = brandId === '89' ? (
      ['28','332','435','228','426'].includes(String(modelId)) ? 'PICKUP' :
      ['176','765','17','409'].includes(String(modelId)) ? 'MINI_TRUCK' :
      model.modelo === 'VIEW GRAND' ? 'VP' : model.familia
    ) : model.familia;
    if (!family) throw new Error('UNRESOLVED_MODEL_FAMILY');
    const key = channel + ':' + String(modelId);
    if (!groups.has(key)) groups.set(key, { channel, modelo_id: String(modelId), marca_id: String(brandId), marca: model.marca,
      modelo: model.modelo, familia: family, ventas: 0, proyeccion: 0, enviado_no_facturado: 0, total: 0 });
    return groups.get(key);
  };
  const ownBrandByVin = new Map(ownWork.rows.map(sale =>
    [String(sale.vin).trim().toUpperCase(), String(sale.brand_id ?? '')]));
  const storeBrands = new Map();
  for (const sale of sales.details) {
    const id = String(sale.sucursal_id);
    if (!storeBrands.has(id)) storeBrands.set(id, { foton: 0, dongfeng: 0 });
    const brand = ownBrandByVin.get(String(sale.vin).trim().toUpperCase());
    if (brand === '89') storeBrands.get(id).foton++;
    else if (brand === '71') storeBrands.get(id).dongfeng++;
  }
  for (const sale of ownWork.rows) group('OWN_STORES', sale.brand_id, sale.model_id).ventas++;
  for (const sale of work.rows) {
    if (dealers.has(String(sale.dealer_group_id ?? ''))) group('DEALERS', sale.brand_id, sale.model_id).ventas++;
  }
  for (const sale of work.rows) {
    const id = String(sale.dealer_group_id ?? 0);
    if (!/^\d+$/.test(id)) throw new Error('UNRESOLVED_DAILY_IDENTITY');
    // October sales cannot expand the universe of dealers active in September.
    if (dealers.has(id)) {
      add(dealers, id, dealers.get(id).name, sale.sale_date);
      const brand = String(sale.brand_id ?? '');
      summary.dealers.total++;
      summary.dealers[brand === '89' ? 'foton' : brand === '71' ? 'dongfeng' : 'unidentified']++;
    }
  }
  // Same live endpoint and aggregation used by weekly-projections/results.
  const projected = new Map(await Promise.all(catalog.sucursales.map(async store => {
    const sid = String(store.sucursal_id);
    const response = await getProjections(new Request(`${origin}/api/weekly-projections/projections?sucursal_id=${encodeURIComponent(sid)}&week_start=2026-10-26`));
    const data = await response.json();
    if (!response.ok || data?.ok !== true || !Array.isArray(data.projections))
      throw new Error(data?.error || 'INCOMPLETE_LIVE_PROJECTIONS');
    return [sid, data.projections.reduce((sum, row) => {
      const count = Number(row.projected_units || 0);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('INVALID_PROJECTION_UNITS');
      const model = catalogByModel.get(String(row.modelo_id ?? ''));
      group('OWN_STORES', model?.marca_id, row.modelo_id).proyeccion += count;
      return sum + count;
    }, 0)];
  })));
  const entryDay = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = entryDay.format(new Date());
  const sent = new Map(await Promise.all(catalog.sucursales.map(async store => {
    const sid = String(store.sucursal_id);
    const response = await getNotInvoiced(new Request(`${origin}/api/weekly-projections/not-invoiced?sucursal_id=${encodeURIComponent(sid)}&week_start=2026-10-26`));
    const data = await response.json();
    if (!response.ok || data?.ok !== true || !Array.isArray(data.items))
      throw new Error(data?.error || 'INCOMPLETE_SENT_NOT_INVOICED');
    return [sid, data.items.reduce((sum, row) => {
      const entered = row.sent_at == null ? null : new Date(row.sent_at);
      if (!entered || !Number.isFinite(entered.getTime())) throw new Error('INVALID_SENT_ENTRY_DATE');
      if (entryDay.format(entered) !== today) return sum;
      const count = Number(row.units || 0);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('INVALID_SENT_PRODUCT_UNITS');
      const model = catalogByModel.get(String(row.modelo_id ?? ''));
      group('OWN_STORES', model?.marca_id, row.modelo_id).enviado_no_facturado += count;
      return sum + count;
    }, 0)];
  })));
  for (const row of groups.values()) row.total = row.ventas + row.proyeccion + row.enviado_no_facturado;
  const finance = saved[0].payload.companyFinance;
  const storeFinance = new Map((finance?.stores || []).map(row => [String(row.sucursal_id), row]));
  const currentFinance = finance?.periods?.find(row => row.label === 'CURRENT');
  // Admin has approvals and UFI executed, but no unambiguous CURSE indicator.
  const forum = (cotizaciones, precursadas) => ({ cotizaciones, precursadas, cursadas: null,
    cursadas_status: 'UNAVAILABLE_IN_PROJECTIONS', precurse_snapshot_date: finance?.precurse?.snapshot_date || null });
  for (const row of own.values()) {
    const source = storeFinance.get(row.id);
    row.sucursal_id = row.id;
    row.sales = row.total;
    row.foton = storeBrands.get(row.id)?.foton || 0;
    row.dongfeng = storeBrands.get(row.id)?.dongfeng || 0;
    if (row.foton + row.dongfeng > row.sales) throw new Error('INVALID_STORE_BRAND_TOTAL');
    row.projected_units = projected.get(row.id) || 0;
    row.sent_not_invoiced_units = sent.get(row.id) || 0;
    row.expected_total = row.sales + row.projected_units + row.sent_not_invoiced_units;
    // Same zero defaults as renderStoreFinanceTable, only when the source exists.
    row.forum = forum(Array.isArray(finance?.stores) ? Number(source?.cotizaciones || 0) : null,
      Array.isArray(finance?.stores) && finance?.precurse ? Number(source?.precurse || 0) : null);
  }
  summary.stores.projected_units = [...projected.values()].reduce((sum, value) => sum + value, 0);
  summary.stores.sent_not_invoiced_units = [...sent.values()].reduce((sum, value) => sum + value, 0);
  summary.stores.expected_total = summary.stores.total + summary.stores.projected_units + summary.stores.sent_not_invoiced_units;
  if ([...groups.values()].filter(row => row.channel === 'OWN_STORES')
      .reduce((n, row) => n + row.enviado_no_facturado, 0) !== summary.stores.sent_not_invoiced_units)
    throw new Error('SENT_TODAY_MODEL_TOTAL_MISMATCH');
  // Sent model detail uses only today's live pending entries, matching the headline.
  const modelRows = [...groups.values()];
  const familyRows = [...new Set(modelRows.map(row => row.channel + ':' + row.marca + ':' + row.familia))].map(key => {
    const rows = modelRows.filter(row => row.channel + ':' + row.marca + ':' + row.familia === key);
    return { channel: rows[0].channel, marca: rows[0].marca, marca_id: rows[0].marca_id, familia: rows[0].familia,
      ventas: rows.reduce((n,row)=>n+row.ventas,0),
      proyeccion: rows.reduce((n,row)=>n+row.proyeccion,0),
      enviado_no_facturado: rows.reduce((n,row)=>n+row.enviado_no_facturado,0),
      total: rows.reduce((n,row)=>n+row.total,0) };
  });
  if (modelRows.filter(row => row.channel === 'OWN_STORES').reduce((n, row) => n + row.ventas, 0) !== summary.stores.total ||
      modelRows.filter(row => row.channel === 'DEALERS').reduce((n, row) => n + row.ventas, 0) !== summary.dealers.total)
    throw new Error('PRODUCT_CHANNEL_SALES_TOTAL_MISMATCH');
  summary.product_models = modelRows;
  summary.product_families = familyRows;
  summary.product_sent_scope = 'TODAY_ONLY';
  // Company indicators retain Admin's totals, including any unresolved store coverage.
  summary.stores.forum = forum(currentFinance ? Number(currentFinance.cotizaciones || 0) : null,
    finance?.precurse ? Number(finance.precurse.value || 0) : null);
  return NextResponse.json({ ok: true, environment: env, period, cutoff_date,
    monday_date: '2026-10-26', daily_basis: 'SALE_DATE_AT_CUTOFF',
    stores: [...own.values()], dealers: [...dealers.values()], summary,
    sources: { stores: { table: 'weekly_projection_results', updated_at: saved[0].updated_at,
      sent_not_invoiced_date: today, sent_not_invoiced_timezone: TIMEZONE },
      dealers: { dataset: work.dataset, version: work.version, filters: work.filters, run_id } } });
}

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(k => !['period', 'cutoff_date', 'view', 'refresh'].includes(k) || params.getAll(k).length !== 1) ||
        (params.has('view') && params.get('view') !== 'daily') ||
        (params.has('refresh') && (params.get('refresh') !== '1' || params.get('view') !== 'daily')))
      invalid('INVALID_PARAMETERS');
    const { period, cutoff_date } = dates(Object.fromEntries(params));
    const env = environment();
    if (params.get('view') === 'daily') {
      if (env !== 'staging') return bad('STAGING_ONLY', 403);
      const sql = db();
      if (params.get('refresh') !== '1') {
        const cached = await sql.query(`SELECT payload->'closing_daily' AS detail
          FROM weekly_projection_results
          WHERE environment=$1 AND week_start='2026-10-26'::date
            AND cutoff_date<=$2::date AND scope_key='COMPANY'
            AND payload ? 'closing_daily'
          ORDER BY cutoff_date DESC LIMIT 1`, [env, cutoff_date]);
        if (!cached.length) return bad('CLOSING_DAILY_SNAPSHOT_NOT_FOUND', 404);
        return NextResponse.json(cached[0].detail);
      }
      const calculated = await dailyTables(period, cutoff_date, env, new URL(request.url).origin);
      if (!calculated.ok) return calculated;
      const data = await calculated.json();
      const updated = await sql.query(`UPDATE weekly_projection_results
        SET payload=jsonb_set(payload,'{closing_daily}',$1::jsonb,true)
        WHERE environment=$2 AND week_start='2026-10-26'::date
          AND cutoff_date=$3::date AND scope_key='COMPANY'
        RETURNING scope_key`, [JSON.stringify(data), env, cutoff_date]);
      if (updated.length !== 1) throw new Error('CLOSING_SNAPSHOT_SAVE_FAILED');
      return NextResponse.json(data);
    }
    const rows = await store.latest({ environment: env, period: period + '-01', cutoff_date });
    if (!rows.length) return bad('SNAPSHOT_NOT_FOUND', 404);
    const first = rows[0];
    if (rows.some(row => row.generation_id !== first.generation_id || row.period !== first.period ||
        row.cutoff_date !== first.cutoff_date || row.environment !== env)) throw new Error('INCONSISTENT_GENERATION');
    const { generation_id, generated_at, cutoff_at, cutoff_timezone, sources, engine_version } = first;
    return NextResponse.json({ ok: true, environment: env, period: first.period,
      requested_cutoff_date: cutoff_date, cutoff_date: first.cutoff_date, cutoff_at, cutoff_timezone,
      generation_id, generated_at, sources, engine_version,
      rows: rows.map(({ dimension, dimension_id, payload }) => ({ dimension, dimension_id, payload })) });
  } catch (error) {
    return bad(error?.message || 'Internal server error', error?.status || 500);
  }
}

export async function POST(request) {
  try {
    const env = environment();
    if (env !== 'staging') return bad('STAGING_ONLY', 403);
    let body;
    try { body = await request.json(); } catch { invalid('INVALID_JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(k => !['period', 'cutoff_date', 'cutoff_at'].includes(k))) invalid('INVALID_PARAMETERS');
    const { period, cutoff_date } = dates(body);
    const instant = new Date(body.cutoff_at);
    if (typeof body.cutoff_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(body.cutoff_at) ||
        !Number.isFinite(instant.getTime()) ||
        new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
          .format(instant) !== cutoff_date) invalid('INVALID_CUTOFF');
    const response = await getBranches();
    const branches = await response.json();
    if (!response.ok || branches?.ok !== true || !Array.isArray(branches.sucursales) || !branches.sucursales.length)
      throw new Error('INCOMPLETE_STORE_CATALOG');
    const store_ids = branches.sucursales.map(row => String(row.sucursal_id));
    if (store_ids.some(id => !/^\d+$/.test(id)) || new Set(store_ids).size !== store_ids.length)
      throw new Error('INVALID_STORE_CATALOG');
    // Date-only SALES evidence does not certify historical intraday sales.
    const { publication } = await generate({ run_id: randomUUID(), period, cutoff_date, store_ids,
      cutoff_at: body.cutoff_at, cutoff_timezone: TIMEZONE, engine_version: VERSION, environment: env });
    return NextResponse.json({ ok: true, environment: env, period: period + '-01', cutoff_date, ...publication });
  } catch (error) {
    return bad(error?.message || 'Internal server error', error?.status || 500);
  }
}
