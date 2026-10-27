import { NextResponse } from 'next/server';
import { db, withDbTransaction } from '../../../../lib/db.js';
import { createSnapshotStore } from '../../../../lib/weekly-projection-snapshot.js';
import { GET as getAdmin } from '../admin/route.js';
import { GET as getCompanyFinance } from '../company-finance/route.js';
import { GET as getForumSellers } from '../forum-sellers/route.js';
import { GET as getBranches } from '../sucursales/route.js';
import { GET as getProjections } from '../projections/route.js';
import { GET as getNotInvoiced } from '../not-invoiced/route.js';

export const dynamic = 'force-dynamic';
const snapshots = createSnapshotStore({ db, withDbTransaction });

const bad = (message, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

function dates(params) {
  const weekStart = params.get('week_start') || '';
  const cutoffDate = params.get('cutoff_date') || weekStart;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || Number.isNaN(Date.parse(weekStart)) ||
      new Date(`${weekStart}T00:00:00Z`).toISOString().slice(0, 10) !== weekStart ||
      new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== 1) {
    throw new Error('week_start must be a Monday');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate) || Number.isNaN(Date.parse(cutoffDate)) || new Date(`${cutoffDate}T00:00:00Z`).toISOString().slice(0, 10) !== cutoffDate) {
    throw new Error('cutoff_date must use YYYY-MM-DD');
  }
  return { weekStart, cutoffDate };
}

function environment() {
  // This server-side setting keeps staging and production results in separate scopes.
  const value = String(process.env.PROJECTIONS_ENVIRONMENT || 'staging').trim().toLowerCase();
  if (value !== 'staging' && value !== 'production') {
    throw new Error('PROJECTIONS_ENVIRONMENT must be staging or production');
  }
  return value;
}

async function call(handler, url) {
  const response = await handler(new Request(url));
  const data = await response.json();
  if (!response.ok || data?.ok !== true) throw new Error(data?.error || `Source endpoint failed (${response.status})`);
  return data;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`Incomplete source result: ${name}`);
  return value;
}

function requireAdmin(value, scope) {
  if (!value.sales_mtd || !Array.isArray(value.sales_mtd.details) || !value.historical_context ||
      !Array.isArray(value.historical_context.periods) || !value.next_cut_context) {
    throw new Error(`Incomplete admin result: ${scope}`);
  }
  return value;
}

function requireFinance(value, scope) {
  if (!Array.isArray(value.periods) || !Array.isArray(value.stores)) throw new Error(`Incomplete finance result: ${scope}`);
  return value;
}

function requirePrecurseBundle(value) {
  const company = value?.company, dimensions = value?.dimensions;
  if (company?.authority !== 'P1_CERTIFIED' || company?.status !== 'COMPLETE' ||
      company?.payload?.rule !== 'CERTIFIED_PRECURSE_STAGE_NO_CERTIFIED_CURSE' ||
      !company?.temporal?.snapshot_date || value?.execution?.query_count !== 1) {
    throw new Error('Incomplete or uncertified FORUM PRECURSE bundle');
  }
  for (const dimension of ['STORE', 'SELLER']) {
    const evidence = dimensions?.[dimension];
    if (evidence?.authority !== 'P1_CERTIFIED' || evidence?.status !== 'COMPLETE' ||
        evidence?.temporal?.snapshot_date !== company.temporal.snapshot_date ||
        !Array.isArray(evidence?.payload?.members)) {
      throw new Error('Incomplete PRECURSE ' + dimension + ' evidence');
    }
    if (sum(evidence.payload.members, 'value') !== Number(company.payload.value)) {
      throw new Error('PRECURSE ' + dimension + ' does not reconcile to company');
    }
  }
  if (!value?.sellers_by_store || typeof value.sellers_by_store !== 'object') {
    throw new Error('Missing PRECURSE seller-by-store groups');
  }
  return value;
}

async function callP1Tool(runId, name, args) {
  const endpoint = process.env.P1_BRAND_INDICATORS_ENDPOINT ||
    'https://cidef-motor-test-azure.calmforest-1c67ab46.chilecentral.azurecontainerapps.io/api/como-vamos';
  const url = new URL('/api/mcp', endpoint);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { run_id: runId, ...args } } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(120000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error('P1 brand observation failed (' + response.status + ')');
  const dataLine = body.split(/\r?\n/).find(line => line.startsWith('data:'));
  if (!dataLine) throw new Error('P1 brand observation returned no data');
  const envelope = JSON.parse(dataLine.slice(5).trim());
  if (envelope.error || envelope.result?.isError) {
    throw new Error(envelope.error?.message || envelope.result?.content?.[0]?.text || 'P1 brand observation failed');
  }
  const result = envelope.result?.structuredContent;
  if (result) return result;
  const text = envelope.result?.content?.find(item => item.type === 'text')?.text;
  if (text) return JSON.parse(text);
  throw new Error('P1 brand observation returned no structured result');
}

function certifiedMembers(evidence, name) {
  if (evidence?.authority !== 'P1_CERTIFIED' || !evidence.evidence_id ||
      !['COMPLETE', 'CERTIFIED'].includes(evidence.status) || !Array.isArray(evidence?.payload?.members)) {
    throw new Error('Incomplete P1 grouped evidence: ' + name);
  }
  return evidence.payload.members;
}

async function getP1BrandIndicators(period, cutoffDate, storeIds) {
  const runId = 'weekly-projection-brands-' + period + '-' + cutoffDate;
  const dateFrom = period + '-01', weekFrom = shiftDate(cutoffDate, -6);
  const fetchFrom = weekFrom < dateFrom ? weekFrom : dateFrom;
  // Like production, prepare every store before iterating; never reload P1 per store.
  const observed = await callP1Tool(runId, 'sales_observe_many', {
    measure: 'VIN_SALES', period, cutoff: cutoffDate, commercial_universe: 'OWN_STORES',
    operations: [{ kind: 'TOTAL' }, { kind: 'BRAND_NETWORK' }, { kind: 'STORE_FINANCIAL_ENTITY' }],
  });
  const evidence = kind => observed?.results?.find(row => row.operation?.kind === kind)?.evidence;
  const total = evidence('TOTAL'), brands = evidence('BRAND_NETWORK'), finance = evidence('STORE_FINANCIAL_ENTITY');
  const brandMembers = certifiedMembers(brands, 'BRAND_NETWORK').map(row => {
    const member = row.members?.find(item => item.dimension === 'BRAND');
    if (!member) throw new Error('P1_BRAND_IDENTITY_MISSING');
    return { ...member, value: row.value };
  });
  const financeMembers = certifiedMembers(finance, 'STORE_FINANCIAL_ENTITY');
  const work = await callP1Tool(runId, 'data_fetch', {
    source: 'SALES', filters: { commercial_universe: 'OWN_STORES', date_from: fetchFrom, date_to: cutoffDate },
    fields: ['vin', 'sale_date', 'brand_id', 'store_id', 'financial_entity'],
  });
  // Reuse the SALES_WORK presentation projection used by the existing Forum publisher:
  // P1 recognizes sales and identities; this route only groups its complete rows.
  if (work?.source !== 'SALES' || work.dataset !== 'SALES_WORK' || work.grain !== 'RECOGNIZED_SALE' ||
      !Array.isArray(work.rows) || work.rows.length !== work.size?.filtered_n ||
      total?.authority !== 'P1_CERTIFIED' || !total.evidence_id ||
      total.payload?.value !== work.rows.filter(row => row.sale_date >= dateFrom).length ||
      total.temporal?.date_from !== dateFrom || total.temporal?.date_to !== cutoffDate ||
      new Set(work.rows.map(row => row.vin)).size !== work.rows.length) throw new Error('P1_SALES_WORK_PARITY_FAILED');
  const label = value => String(value ?? '').trim().toUpperCase();
  const brandKey = new Map(brandMembers.map(row => [String(row.member_id),
    label(row.member_label) === 'FOTON' ? 'foton' : ['DONGFENG', 'DFM'].includes(label(row.member_label)) ? 'dongfeng' : null]));
  // Same canonical brand filters as the previous weekly observations, including
  // a brand sold last month but absent from this month's observation.
  brandKey.set('89', 'foton'); brandKey.set('71', 'dongfeng');
  const refs = [total.evidence_id, brands.evidence_id, finance.evidence_id];
  const blank = () => Object.fromEntries(['sales', 'weekly_sales', 'ufis', 'other_credits'].map(id => [id, {
    foton: 0, dongfeng: 0, ...(id === 'other_credits' ? {} : { company: 0 }), source: 'SALES P1',
    cutoff: cutoffDate, evidence_ids: refs, ...(id === 'weekly_sales' ? { date_from: weekFrom } : {}),
    source_dataset: work.dataset, source_version: work.version,
  }]));
  const company = blank(), stores = Object.fromEntries(storeIds.map(id => [id, blank()]));
  const brandCounts = new Map(), financeCounts = new Map();
  for (const row of work.rows) {
    if (!row.vin || !row.sale_date || row.sale_date < fetchFrom || row.sale_date > cutoffDate) throw new Error('INVALID_SALES_P1_ROW');
    const bid = String(row.brand_id ?? 'UNRESOLVED'), sid = String(row.store_id ?? 'UNRESOLVED');
    const entity = label(row.financial_entity) || 'UNRESOLVED', key = JSON.stringify([sid, entity]);
    const brand = brandKey.get(bid);
    if (row.sale_date >= dateFrom) {
      brandCounts.set(bid, (brandCounts.get(bid) || 0) + 1);
      financeCounts.set(key, (financeCounts.get(key) || 0) + 1);
    }
    for (const target of [company, stores[sid]].filter(Boolean)) {
      if (brand && row.sale_date >= weekFrom) { target.weekly_sales[brand]++; target.weekly_sales.company++; }
      if (row.sale_date < dateFrom) continue;
      target.sales.company++;
      if (!brand) continue; // Unknown brands stay in totals, never allocated.
      target.sales[brand]++;
      if (entity === 'FORUM') { target.ufis[brand]++; target.ufis.company++; }
      else if (entity !== 'UNRESOLVED' && !entity.includes('NO RESUELTO')) target.other_credits[brand]++;
    }
  }
  const expectedBrands = new Map(brandMembers.map(row => [String(row.member_id), row.value]));
  const expectedFinance = new Map();
  for (const row of financeMembers) {
    const key = JSON.stringify([
      String(row.members.find(member => member.dimension === 'STORE')?.member_id),
      label(row.members.find(member => member.dimension === 'FINANCIAL_ENTITY')?.member_id),
    ]);
    expectedFinance.set(key, (expectedFinance.get(key) || 0) + row.value);
  }
  const sameCounts = (actual, expected) => actual.size === expected.size && [...expected].every(([key, value]) => actual.get(key) === value);
  if (!sameCounts(brandCounts, expectedBrands) || !sameCounts(financeCounts, expectedFinance)) throw new Error('P1_SALES_GROUP_PARITY_FAILED');
  for (const [id, measure] of [['quotations', 'QUOTATIONS'], ['approved', 'COHORT_APPROVED'], ['precurse', 'PRECURSE']]) {
    const observations = [];
    for (const brandId of [null, '89', '71']) {
      observations.push(await callP1Tool(runId, 'data_observe', {
        source: 'FORUM', measure, evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET', dimension: 'STORE',
        ...(id === 'precurse' ? {} : { period_from: period, period_to: period, cutoff: cutoffDate }),
        filters: { network: ['OWN_STORES'], ...(brandId ? { brand_id: brandId } : {}) },
      }));
    }
    const members = observations.map((item, index) => certifiedMembers(item, measure + ':' + index));
    const dates = observations.map(item => item.temporal?.snapshot_date || item.temporal?.to || item.temporal?.cutoff || null);
    if (id === 'precurse' && (!dates[0] || dates.some(date => date !== dates[0]))) throw new Error('P1_PRECURSE_SNAPSHOT_MISMATCH');
    const values = members.map(rows => new Map(rows.map(row => [String(row.member_id), Number(row.value)])));
    const metric = sid => ({ company: sid == null ? sum(members[0], 'value') : values[0].get(sid) || 0,
      foton: sid == null ? sum(members[1], 'value') : values[1].get(sid) || 0,
      dongfeng: sid == null ? sum(members[2], 'value') : values[2].get(sid) || 0,
      cutoff: dates[0], source: 'FORUM P1', evidence_ids: observations.map(item => item.evidence_id) });
    company[id] = metric(null);
    for (const sid of storeIds) stores[sid][id] = metric(sid);
  }
  return { company, stores };
}

function shiftDate(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function getPrecurseBundle() {
  const endpoint = process.env.FORUM_P1_PRECURSE_ENDPOINT ||
    'https://cidef-motor-test-azure.calmforest-1c67ab46.chilecentral.azurecontainerapps.io/api/precurse-snapshot';
  const response = await fetch(endpoint, {
    cache: 'no-store',
    signal: AbortSignal.timeout(45000),
  });
  const value = await response.json();
  if (!response.ok || value?.ok !== true) {
    throw new Error(value?.error || 'FORUM PRECURSE P1 request failed (' + response.status + ')');
  }
  return requirePrecurseBundle(value);
}

function precurseSummary(evidence, unresolvedStoreValue = 0, unresolvedSellerValue = 0) {
  return {
    value: Number(evidence?.payload?.value || 0),
    snapshot_date: evidence?.temporal?.snapshot_date || null,
    evidence_id: evidence?.evidence_id || null,
    evidence_version: evidence?.evidence_version || null,
    authority: evidence?.authority || null,
    unresolved_store_value: Number(unresolvedStoreValue || 0),
    unresolved_seller_value: Number(unresolvedSellerValue || 0),
  };
}

function resultRow({ weekStart, cutoffDate, env, dimension, scopeKey, storeId = null, personId = null, payload }) {
  if (!payload || typeof payload !== 'object') throw new Error(`Incomplete ${dimension} result: ${scopeKey}`);
  return { weekStart, cutoffDate, env, dimension, scopeKey, storeId, personId, payload };
}

function sum(rows, field) { return rows.reduce((total, row) => total + Number(row[field] || 0), 0); }

function yoySales(periods, reference) {
  const period=Array.isArray(periods)?periods.find(p=>p.label==='YOY'):null;
  if(!reference?.date_from||!reference?.cutoff_date||!period||period.date_from!==reference.date_from||period.cutoff_date!==reference.cutoff_date||
      !Number.isInteger(period.mtd_units)||period.mtd_units<0)return null;
  return {date_from:period.date_from,cutoff_date:period.cutoff_date,total_units:period.mtd_units,
    details:Array.isArray(period.details)?period.details:null};
}

export async function GET(request) {
  try {
    const url = new URL(request.url), { weekStart, cutoffDate } = dates(url.searchParams);
    const env = environment(), storeId = url.searchParams.get('sucursal_id') || null;
    if (url.searchParams.get('status') === '1') return NextResponse.json({ ok: true, environment: env, ...(await readRefreshStatus(weekStart, cutoffDate, env)) });
    if (storeId && !/^\d+$/.test(storeId)) return bad('Invalid sucursal_id');
    const sql = db();
    const rows = await sql`
      SELECT dimension, scope_key, sucursal_id::text, persona_id::text, payload, updated_at::text
      FROM weekly_projection_results
      WHERE week_start=${weekStart}::date AND cutoff_date=${cutoffDate}::date AND environment=${env}
        AND scope_key=${storeId ? `STORE:${storeId}` : 'COMPANY'}
    `;
    if (!rows.length) return bad('No hay resultados guardados para este corte. Pulsa Actualizar.', 404);
    const cached = rows[0];
    const storeSales = !storeId ? await sql`
      SELECT sucursal_id::text AS sucursal_id, payload->'admin'->'sales_mtd'->>'total_units' AS total_units,
         payload->'admin'->'historical_context'->'periods' AS historical_periods
      FROM weekly_projection_results
      WHERE week_start=${weekStart}::date AND cutoff_date=${cutoffDate}::date AND environment=${env}
        AND dimension='STORE'
    ` : [];
    const branches = await call(getBranches, `${url.origin}/api/weekly-projections/sucursales`);
    const scopeStores = storeId ? branches.sucursales.filter(s => String(s.sucursal_id) === storeId) : branches.sucursales;
    if (!scopeStores.length) throw new Error('No fue posible resolver la tienda del resultado');

    // Projections and sent-not-invoiced remain live reads from their current tables.
    const liveByStore = await Promise.all(scopeStores.map(async (store) => {
      const sid = String(store.sucursal_id);
      const [projectionData, sentData] = await Promise.all([
        call(getProjections, `${url.origin}/api/weekly-projections/projections?sucursal_id=${sid}&week_start=${weekStart}`),
        call(getNotInvoiced, `${url.origin}/api/weekly-projections/not-invoiced?sucursal_id=${sid}&week_start=${weekStart}`),
      ]);
      return {
        projections: projectionData.projections.map(row => ({ ...row, sucursal_id: sid, sucursal: store.nombre_canonico })),
        sent: sentData.items.map(row => ({ ...row, sucursal_id: sid, sucursal: store.nombre_canonico })),
      };
    }));
    const projections = liveByStore.flatMap(x => x.projections);
    const sent = liveByStore.flatMap(x => x.sent);
    const payload = cached.payload.admin;
    const yoyPeriod = payload.historical_context.periods.find(p=>p.label==='YOY');
    // Legacy snapshots lack seller details; an absent array is never an observed zero.
    if(yoyPeriod&&!Array.isArray(yoyPeriod.details))yoyPeriod.details=null;
    payload.projections = projections;
    payload.sent_not_invoiced = sent;
    payload.summary = { total_units: sum(projections, 'projected_units'), sent_not_invoiced_units: sum(sent, 'units') };
    const current = payload.historical_context.periods.find(p => p.label === 'CURRENT');
    payload.next_cut_context.expected_units = Number(current.mtd_units || 0) + payload.summary.total_units;

    // The current cut's live projections also feed the previous-cut comparison.
    if (payload.evolution?.previous_cut) {
      const previousByStore = await Promise.all(scopeStores.map(async (store) => {
        const data = await call(getProjections, `${url.origin}/api/weekly-projections/projections?sucursal_id=${store.sucursal_id}&week_start=${payload.evolution.previous_cut}`);
        return { store, units: sum(data.projections, 'projected_units') };
      }));
      const previousTotal = sum(previousByStore, 'units');
      payload.evolution.previous_projection = previousTotal;
      payload.evolution.expected_current = Number(payload.evolution.previous_sales_mtd || 0) + previousTotal;
      if (payload.evolution.stores?.length) {
        const old = new Map(previousByStore.map(x => [String(x.store.sucursal_id), x.units]));
        for (const row of payload.evolution.stores) {
          const projected = old.get(String(row.sucursal_id)) || 0;
          row.previous_projection = projected;
          row.expected_current = Number(row.previous_sales_mtd || 0) + projected;
          row.projection_fulfillment = projected ? Number(row.new_sales || 0) / projected : null;
          row.expected_fulfillment = row.expected_current ? Number(row.current_sales_mtd || 0) / row.expected_current : null;
        }
      }
    }

    const sellers = storeId ? await sql`
      SELECT payload FROM weekly_projection_results
      WHERE week_start=${weekStart}::date AND cutoff_date=${cutoffDate}::date AND environment=${env}
        AND dimension='SELLER' AND sucursal_id=${storeId}::bigint
      ORDER BY persona_id
    ` : [];
    const sellerPayloads = sellers.map(r => r.payload);
    return NextResponse.json({
      ok: true, week_start: weekStart, cutoff_date: cutoffDate, sucursal_id: storeId,
      admin: payload, companyFinance: cached.payload.companyFinance,
      storeSales: storeSales.map(r => ({ sucursal_id: r.sucursal_id, total_units: Number(r.total_units || 0),
        yoy: yoySales(r.historical_periods, yoyPeriod) })),
      forumSellerData: storeId ? {
        aliases: cached.payload.aliases,
        forum: sellerPayloads.map(x => x.forum).filter(Boolean),
      } : { aliases: [], forum: [] },
      updated_at: cached.updated_at,
    });
  } catch (error) {
    console.error(error);
    if (error?.code === '42P01') return bad('No hay resultados guardados para este corte. Pulsa Actualizar.', 404);
    return bad(error?.message || 'Internal server error', 500);
  }
}

async function readRefreshStatus(weekStart, cutoffDate, env) {
  try {
    return await snapshots.status(weekStart, cutoffDate, env);
  } catch (error) {
    if (error?.code === '42P01') return { status: 'idle' };
    throw error;
  }
}

async function performRefresh(weekStart, cutoffDate, origin, job, env) {
    const branches = await call(getBranches, `${origin}/api/weekly-projections/sucursales`);
    if (!Array.isArray(branches.sucursales) || !branches.sucursales.length) throw new Error('No se recibieron tiendas para calcular los resultados');
    const rows = [];
    const scopeIds = branches.sucursales.map(store => String(store.sucursal_id));
    const scopeQuery = encodeURIComponent(scopeIds.join(','));
    const period = cutoffDate.slice(0, 7);
    const previousMonthEnd = new Date(Date.UTC(Number(period.slice(0,4)), Number(period.slice(5,7)) - 1, 0)).toISOString().slice(0,10);
    const previousMonday = new Date(previousMonthEnd+'T12:00:00Z');
    previousMonday.setUTCDate(previousMonday.getUTCDate()-((previousMonday.getUTCDay()+6)%7));
    const previousWeekStart = previousMonday.toISOString().slice(0,10);
    const [companyAdmin, companyFinance, sellerData, precurseBundle, previousMonthAdmin] = await Promise.all([
      call(getAdmin, `${origin}/api/weekly-projections/admin?week_start=${weekStart}&cutoff_date=${cutoffDate}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getCompanyFinance, `${origin}/api/weekly-projections/company-finance?cutoff_date=${cutoffDate}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getForumSellers, `${origin}/api/weekly-projections/forum-sellers?all_stores=1&cutoff_date=${cutoffDate}`),
      getPrecurseBundle(),
      call(getAdmin, `${origin}/api/weekly-projections/admin?week_start=${previousWeekStart}&cutoff_date=${previousMonthEnd}&include_scopes=1&scope_ids=${scopeQuery}`),
    ]);
    requireAdmin(companyAdmin, 'COMPANY');
    requireFinance(companyFinance, 'COMPANY');
    requireArray(sellerData.aliases, 'SELLER_ALIASES');
    requireArray(sellerData.forum, 'SELLER_FORUM');
    requireArray(sellerData.sellers, 'SELLER_ROSTER');
    if (!companyAdmin.scopes || !companyFinance.scopes) throw new Error('Incomplete grouped store results');

    const brandIndicators = await getP1BrandIndicators(period, cutoffDate, scopeIds);
    companyAdmin.brand_indicators = brandIndicators.company;
    companyFinance.brand_indicators = brandIndicators.company;

    const precurseCompany = precurseBundle.company;
    const precurseStoreMembers = new Map(
      precurseBundle.dimensions.STORE.payload.members.map(member => [String(member.member_id), member]),
    );
    const precurseSellersByStore = precurseBundle.sellers_by_store;
    const precurseStoreEvidence = precurseBundle.dimensions.STORE;
    const precurseSellerEvidence = precurseBundle.dimensions.SELLER;
    companyFinance.precurse = precurseSummary(
      precurseCompany,
      precurseStoreEvidence.coverage.dimension_unresolved_value,
      precurseSellerEvidence.coverage.dimension_unresolved_value,
    );
    companyFinance.stores = companyFinance.stores.map(store => ({
      ...store,
      precurse: Number(precurseStoreMembers.get(String(store.sucursal_id))?.value || 0),
    }));

    const storeAdminScopes = companyAdmin.scopes, storeFinanceScopes = companyFinance.scopes;
    delete companyAdmin.scopes;
    delete companyFinance.scopes;
    delete companyAdmin.projections;
    delete companyAdmin.sent_not_invoiced;
    // Historical YOY details stay in historical_context.periods for company and every store.
    companyAdmin.sales_mtd.details = companyAdmin.sales_mtd.details.map(({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta }) => ({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta }));
    rows.push(resultRow({ weekStart, cutoffDate, env, dimension: 'COMPANY', scopeKey: 'COMPANY', payload: { admin: companyAdmin, companyFinance } }));

    job.totalStores = branches.sucursales.length;
    await snapshots.update(weekStart, cutoffDate, env, job);
    let completedStores = 0;
    for (const store of branches.sucursales) {
      const storeId = String(store.sucursal_id);
      const admin = storeAdminScopes[storeId], finance = storeFinanceScopes[storeId];
      if (!admin || !finance) throw new Error(`Missing grouped result for store ${storeId}`);
      delete admin.projections;
      delete admin.sent_not_invoiced;
      admin.sales_mtd.details = admin.sales_mtd.details.map(({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta }) => ({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta }));
      const storeBrandIndicators = brandIndicators.stores[storeId];
      admin.brand_indicators = storeBrandIndicators;
      finance.brand_indicators = storeBrandIndicators;
      const aliases = sellerData.aliases.filter(a => String(a.sucursal_id) === storeId);
      const storeMember = precurseStoreMembers.get(storeId);
      const sellerGroups = precurseSellersByStore[storeId]?.members || [];
      const resolvedSellerGroups = sellerGroups.filter(member => /^\d+$/.test(String(member.member_id)));
      const unresolvedSellerValue = sellerGroups
        .filter(member => String(member.member_id) === 'UNRESOLVED' || String(member.member_id).startsWith('UNRESOLVED:'))
        .reduce((total, member) => total + Number(member.value || 0), 0);
      finance.precurse = {
        ...precurseSummary(precurseCompany, 0, unresolvedSellerValue),
        value: Number(storeMember?.value || 0),
        evidence_id: precurseStoreEvidence.evidence_id,
      };
      const previousMonthSales = previousMonthAdmin.scopes?.[storeId]?.sales_mtd?.details || [];
      rows.push(resultRow({ weekStart, cutoffDate, env, dimension: 'STORE', scopeKey: `STORE:${storeId}`, storeId, payload: { admin: { ...admin, previous_month_sales: previousMonthSales.map(({ vin, persona_id, vendedor, vendedor_nombre }) => ({ vin, persona_id, vendedor, vendedor_nombre })) }, companyFinance: finance, aliases } }));
      const sellerIds = new Set([
        ...sellerData.sellers.filter(s => String(s.sucursal_id) === storeId).map(s => String(s.persona_id)),
        ...resolvedSellerGroups.map(member => String(member.member_id)),
      ]);
      for (const sellerId of sellerIds) {
        const existingForum = sellerData.forum.find(s => String(s.sucursal_id) === storeId && String(s.persona_id) === sellerId) || {};
        const precurseMember = resolvedSellerGroups.find(member => String(member.member_id) === sellerId);
        const forum = {
          ...existingForum,
          sucursal_id: storeId,
          persona_id: sellerId,
          nombre: precurseMember?.member_label || existingForum.nombre || null,
          precurse: Number(precurseMember?.value || 0),
          precurse_evidence_id: precurseSellerEvidence.evidence_id,
        };
        rows.push(resultRow({ weekStart, cutoffDate, env, dimension: 'SELLER', scopeKey: `SELLER:${storeId}:${sellerId}`, storeId, personId: sellerId, payload: { forum } }));
      }
      completedStores += 1;
      job.completedStores = completedStores;
      await snapshots.update(weekStart, cutoffDate, env, job);
    }

    return snapshots.publish(weekStart, cutoffDate, env, job, rows);
}

export async function POST(request) {
  let weekStart, cutoffDate, job, env, heartbeat;
  try {
    env = environment();
    if (env !== 'staging') return bad('STAGING_ONLY', 403);
    const body = await request.json();
    if (body.automatic) return bad('La actualización se inicia manualmente desde el botón Actualizar.', 400);
    ({ weekStart, cutoffDate } = dates(new URLSearchParams({ week_start: body.week_start || '', cutoff_date: body.cutoff_date || '' })));
    const sources = await snapshots.sources();
    if (sources.status !== 'READY') return bad('La última carga aún no tiene publicación completa certificada.', 409);
    // A manual click always recalculates: omit the source argument used for automatic deduplication.
    const claimed = await snapshots.claim(weekStart, cutoffDate, env);
    if (!claimed.claimed) {
      return NextResponse.json({ ok: true, queued: true, environment: env, ...claimed }, { status: 202 });
    }
    job = { ...claimed, sources };
    await snapshots.update(weekStart, cutoffDate, env, job);
    // Reuse the coordinator heartbeat: an expired/replaced worker cannot publish its results.
    heartbeat = setInterval(() => {
      snapshots.update(weekStart, cutoffDate, env, job).catch(error => console.error('Snapshot heartbeat:', error.message));
    }, 30_000);
    heartbeat.unref?.();
    const origin = new URL(request.url).origin;
    return NextResponse.json(await performRefresh(weekStart, cutoffDate, origin, job, env));
  } catch (error) {
    console.error(error);
    if (job) {
      const failed = { ...job, status: 'failed', error: error?.message || 'No fue posible actualizar los resultados', finished_at: new Date().toISOString() };
      try { await snapshots.update(weekStart, cutoffDate, env, failed); } catch (statusError) { console.error(statusError.message); }
      return NextResponse.json({ ok: false, ...failed }, { status: 500 });
    }
    return bad(error?.message || 'Internal server error', 400);
  } finally {
    clearInterval(heartbeat);
  }
}
