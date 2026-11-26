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
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'data_query', arguments: name === 'data_observe' ? { run_id: runId, source: args.source, request: { measure: args.measure, ...(args.period_from ? { time: { from_period: args.period_from, to_period: args.period_to, cutoff: args.cutoff } } : {}), filters: args.filters, group_by: [args.dimension] } } : { run_id: runId, action: name, arguments: args } } }),
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

async function getP1BrandIndicators(period, cutoffDate, storeIds, refreshId) {
  const runId = 'weekly-projection-brands-' + refreshId;
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
  const parityChecks = {
    source: work?.source === 'SALES',
    dataset: work?.dataset === 'SALES_WORK',
    grain: work?.grain === 'RECOGNIZED_SALE',
    rows: Array.isArray(work?.rows),
    filtered_count: Array.isArray(work?.rows) && work.rows.length === work.size?.filtered_n,
    authority: total?.authority === 'P1_CERTIFIED',
    evidence: Boolean(total?.evidence_id),
    total_count: Array.isArray(work?.rows) && total?.payload?.value === work.rows.filter(row => row.sale_date >= dateFrom).length,
    date_from: total?.temporal?.date_from === dateFrom,
    date_to: total?.temporal?.date_to === cutoffDate,
    unique_vins: Array.isArray(work?.rows) && new Set(work.rows.map(row => row.vin)).size === work.rows.length,
  };
  const parityFailures = Object.entries(parityChecks).filter(([, valid]) => !valid).map(([name]) => name);
  if (parityFailures.length) {
    const totalRows = Array.isArray(work?.rows) ? work.rows.filter(row => row.sale_date >= dateFrom).length : null;
    console.error('SALES parity diagnostic', JSON.stringify({runId,dateFrom,cutoffDate,expected:total?.payload?.value,observed:totalRows,filtered:work?.size?.filtered_n,failed:parityFailures}));
    throw new Error('P1_SALES_WORK_PARITY_FAILED: ' + parityFailures.join(',') + (parityFailures.includes('total_count') ? ` (P1=${total?.payload?.value}, filas=${totalRows})` : ''));
  }
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

function historicalSales(periods, reference, label) {
  const period=Array.isArray(periods)?periods.find(p=>p.label===label):null;
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
    const storeSales = await sql`
      SELECT sucursal_id::text AS sucursal_id, payload->'admin'->'sales_mtd'->>'total_units' AS total_units,
         payload->'admin'->'historical_context'->'periods' AS historical_periods,
         payload->'admin'->'historical_context'->'yoy'->>'yoy_full_month' AS yoy_full_month,
         payload->'admin'->>'previous_full_month_units' AS mom_full_month,
         payload->'admin'->'previous_full_month_sales' AS mom_full_sales, payload->'crm' AS crm
      FROM weekly_projection_results
      WHERE week_start=${weekStart}::date AND cutoff_date=${cutoffDate}::date AND environment=${env}
        AND dimension='STORE' AND (${storeId}::bigint IS NULL OR sucursal_id=${storeId}::bigint)
    `;
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
    // Keep every PENDING shipment assigned to the selected week, regardless of entry day.
    // The existing not-invoiced endpoint already filters status and week_start.
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const sent = liveByStore.flatMap(x => x.sent);
    // Two previous Monday commitments; the selected Monday projects the following week.
    const previousMonday = new Date(weekStart + 'T12:00:00Z');
    previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
    const priorMonday = new Date(weekStart + 'T12:00:00Z');
    priorMonday.setUTCDate(priorMonday.getUTCDate() - 14);
    const adjacentProjections = await sql`
      SELECT p.week_start::text AS week_start, p.sucursal_id::text AS sucursal_id,
             p.persona_id::text AS persona_id,
             COALESCE(pe.nombre_canonico, p.source_vendedor_raw, 'Sin vendedor') AS vendedor,
             COALESCE(ma.nombre_canonico, p.source_brand_raw, 'Sin marca') AS marca,
             COUNT(*)::int AS units
      FROM weekly_sales_projection p
      LEFT JOIN personas_master pe ON pe.persona_id=p.persona_id
      LEFT JOIN modelos_master_v01 mo ON mo.modelo_id=p.modelo_id
      LEFT JOIN marcas_master_v01 ma ON ma.marca_id=mo.marca_id
      WHERE p.week_start IN (${previousMonday.toISOString().slice(0,10)}::date,${priorMonday.toISOString().slice(0,10)}::date)
        AND (${storeId}::bigint IS NULL OR p.sucursal_id=${storeId}::bigint)
      GROUP BY p.week_start,p.sucursal_id,p.persona_id,pe.nombre_canonico,p.source_vendedor_raw,ma.nombre_canonico,p.source_brand_raw
    `;
    const payload = cached.payload.admin;
    const yoyPeriod = payload.historical_context.periods.find(p=>p.label==='YOY');
    const momPeriod = payload.historical_context.periods.find(p=>p.label==='M-1');
    // Legacy snapshots lack seller details; an absent array is never an observed zero.
    if(yoyPeriod&&!Array.isArray(yoyPeriod.details))yoyPeriod.details=null;
    payload.projections = projections;
    payload.sent_not_invoiced = sent;
    payload.summary = { total_units: sum(projections, 'projected_units'), sent_not_invoiced_units: sum(sent, 'units') };
    // Weekly overview from the existing certified SALES VIN dates and saved Monday projections.
    const month = cutoffDate.slice(0, 7), first = new Date(month + '-01T12:00:00Z');
    // First November 2026 cutoff is Monday Nov 9; later cutoffs are weekly.
    const firstMonday = new Date(first);
    firstMonday.setUTCDate(7);
    firstMonday.setUTCDate(firstMonday.getUTCDate() + (8 - firstMonday.getUTCDay()) % 7);
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12));
    const weeklyTargets = await sql`
      SELECT week_start::text AS week_start, sum(projected_units)::int AS units
      FROM weekly_sales_projection
      WHERE week_start >= ${firstMonday.toISOString().slice(0, 10)}::date
        AND week_start <= ${lastDay.toISOString().slice(0, 10)}::date
        AND (${storeId}::bigint IS NULL OR sucursal_id = ${storeId}::bigint)
      GROUP BY week_start
    `;
    const targetsByWeek = new Map(weeklyTargets.map(row => [row.week_start, Number(row.units)]));
    const salesDates = payload.sales_mtd.details.map(row => row.fecha_venta);
    if (salesDates.length !== Number(payload.sales_mtd.total_units)) {
      throw new Error('Incomplete certified monthly SALES detail for weekly overview');
    }
    // Pending shipments are one-week commitments: read only records
    // assigned to the immediately preceding Monday's close. Never accumulate
    // pending records from earlier weeks, even when their status remains PENDING.
    const yesterday = new Date(today + 'T12:00:00Z');
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const shipmentCutoff = cutoffDate === yesterday.toISOString().slice(0,10) ? today : cutoffDate;
    const sentHistory = await sql`
      SELECT x.units,
             x.week_start::text AS week_start,
             (x.sent_at AT TIME ZONE 'America/Santiago')::date::text AS sent_date,
             (x.resolved_at AT TIME ZONE 'America/Santiago')::date::text AS resolved_date,
             x.status
      FROM sales_sent_not_invoiced x
      JOIN sucursales_master sm ON sm.sucursal_id=x.sucursal_id
      WHERE sm.tipo_canal='CIDEF'
        AND lower(trim(sm.nombre_canonico))<>'casa matriz'
        AND (${storeId}::bigint IS NULL OR x.sucursal_id=${storeId}::bigint)
        AND x.week_start >= ${month + '-01'}::date
        AND (x.sent_at AT TIME ZONE 'America/Santiago')::date <= ${shipmentCutoff}::date
        AND (x.status='PENDING' OR x.resolved_at IS NOT NULL)
    `;
    const pendingAtStart = weekStart => sentHistory.reduce((total, x) =>
      x.week_start === weekStart && x.sent_date <= weekStart &&
      (x.resolved_date ? x.resolved_date > weekStart : x.status === 'PENDING')
        ? total + Number(x.units || 0) : total, 0);
    payload.weekly_overview = [];
    let startDate = month + '-01';
    for (let close = new Date(firstMonday), i = 1; startDate <= lastDay.toISOString().slice(0,10); close.setUTCDate(close.getUTCDate() + 7), i++) {
      const to = close > lastDay ? lastDay.toISOString().slice(0,10) : close.toISOString().slice(0,10);
      const from = startDate;
      const previousClose = new Date(close);
      previousClose.setUTCDate(previousClose.getUTCDate() - 7);
      const entry = salesDates.filter(date => date < from).length;
      const observed = from <= cutoffDate, effectiveEnd = to < cutoffDate ? to : cutoffDate;
      const exit = observed ? salesDates.filter(date => date <= effectiveEnd).length : null;
      const target = i === 1 ? null : targetsByWeek.get(previousClose.toISOString().slice(0, 10)) ?? null;
      const billed = observed ? exit - entry : null;
      const priorCutoff = previousClose.toISOString().slice(0, 10);
      const sentUnits = i === 1 ? 0 : priorCutoff <= shipmentCutoff ? pendingAtStart(priorCutoff) : null;
      const sold = sentUnits == null ? null : entry + sentUnits;
      payload.weekly_overview.push({
        label: 'S' + i, from, to, entry: observed ? entry : null, exit,
        weekly_sales: billed, invoiced_units: billed, invoiced_start_units: entry,
        sent_not_invoiced_units: sentUnits,
        sold_units: sold, projection: target,
        gap: billed !== null && target !== null ? billed - target : null,
        status: !observed ? 'pending' : to <= cutoffDate ? 'closed' : 'partial',
      });
      const next = new Date(to + 'T12:00:00Z');
      next.setUTCDate(next.getUTCDate() + 1);
      startDate = next.toISOString().slice(0,10);
    }
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

    // Reuse the saved seller snapshot for both network and individual store views.
    const sellers = await sql`
      SELECT payload, sucursal_id::text AS sucursal_id, persona_id::text AS persona_id
      FROM weekly_projection_results
      WHERE week_start=${weekStart}::date AND cutoff_date=${cutoffDate}::date AND environment=${env}
        AND dimension='SELLER' AND (${storeId}::bigint IS NULL OR sucursal_id=${storeId}::bigint)
      ORDER BY sucursal_id, persona_id
    `;
    const sellerPayloads = sellers.map(r => ({...r.payload.forum, sucursal_id:r.sucursal_id, persona_id:r.persona_id})).filter(r=>r.precurse_evidence_id || r.cotizaciones != null || r.ufi != null);
    return NextResponse.json({
      ok: true, week_start: weekStart, cutoff_date: cutoffDate, sucursal_id: storeId,
      admin: payload, companyFinance: cached.payload.companyFinance,
      adjacentProjections,
      storeSales: storeSales.map(r => ({ sucursal_id: r.sucursal_id, total_units: Number(r.total_units || 0),
        yoy: historicalSales(r.historical_periods, yoyPeriod, 'YOY'),
        mom: historicalSales(r.historical_periods, momPeriod, 'M-1'),
        yoy_full: r.yoy_full_month == null ? null : Number(r.yoy_full_month),
        mom_full_sales: Array.isArray(r.mom_full_sales) ? r.mom_full_sales : null,
        mom_full: r.mom_full_month == null ? null : Number(r.mom_full_month), crm:r.crm })),
      crmSellers: sellers.filter(r=>r.payload.crm).map(r=>({...r.payload.crm,sucursal_id:r.sucursal_id,persona_id:r.persona_id})),
      forumSellerData: {
        aliases: storeId ? cached.payload.aliases : [],
        forum: sellerPayloads,
      },
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


async function getCrmSnapshot(cutoffDate, branches, sellerData, jobId) {
  const endpoint = process.env.CRM_MCP_ENDPOINT || 'https://cidef-salesforce.calmforest-1c67ab46.chilecentral.azurecontainerapps.io/mcp';
  let session, seq=0;
  async function rpc(method, params, notification=false) {
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(session?{'mcp-session-id':session}:{}),...(process.env.CRM_MCP_TOKEN?{authorization:'Bearer '+process.env.CRM_MCP_TOKEN}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:++seq}),method,params}),signal:AbortSignal.timeout(120000),cache:'no-store'});
    if(!response.ok) throw Error('CRM HTTP '+response.status);
    session=response.headers.get('mcp-session-id')||session;
    if(notification)return;
    const body=await response.text();
    const line=body.split(/\r?\n/).find(x=>x.startsWith('data:'));
    const envelope=JSON.parse(line?line.slice(5):body);
    if(envelope.error||envelope.result?.isError)throw Error('CRM RPC failed');
    return envelope.result;
  }
  await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'weekly-projections',version:'1'}});
  await rpc('notifications/initialized',{},true);
  const from=cutoffDate.slice(0,7)+'-01', next=shiftDate(cutoffDate,1);
  const instant=day=>{
    const utc=new Date(day+'T00:00:00Z');
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',timeZoneName:'longOffset'}).formatToParts(new Date(day+'T12:00:00Z'));
    const offset=parts.find(p=>p.type==='timeZoneName').value.replace('GMT','');
    return new Date(day+'T00:00:00'+(offset||'+00:00')).toISOString();
  };
  async function observe(query) {
    const r=await rpc('tools/call',{name:'data_observe',arguments:{run_id:'weekly-crm-'+jobId,query,refresh:true}});
    let data=r.structuredContent||JSON.parse(r.content.find(x=>x.type==='text').text);
    if(data.text&&typeof data.text==='string')data=JSON.parse(data.text);
    if(data.status!=='SUCCESS'||!data.complete||!Array.isArray(data.records))throw Error('Incomplete CRM '+query.object_name);
    return data.records;
  }
  const leads=await observe({object_name:'Lead',field_map:{branch:'Sucursal_Propietario__c',owner:'OwnerId',status:'Status',origin:'LeadSource',created:'CreatedDate'},filters:[{field:'created',op:'gte',value:instant(from)},{field:'created',op:'lt',value:instant(next)}],group_by:['branch','owner','status','origin']});
  const wins=await observe({object_name:'Opportunity',field_map:{owner:'OwnerId',won:'IsWon',close:'CloseDate'},filters:[{field:'won',op:'eq',value:true},{field:'close',op:'gte',value:from},{field:'close',op:'lte',value:cutoffDate}],group_by:['owner']});
  const users=await observe({object_name:'User',field_map:{id:'Id',name:'Name'}});
  const aliases=await db()`SELECT sucursal_id::text id,valor_raw alias FROM sucursal_aliases WHERE validated UNION SELECT sucursal_id::text,nombre_canonico FROM sucursales_master`;
  const norm=x=>String(x??'').normalize('NFC').trim().replace(/\s+/g,' ').toUpperCase();
  const unique=values=>{const ids=[...new Set(values)];return ids.length===1?ids[0]:null};
  const stores=new Map(branches.map(b=>[String(b.sucursal_id),{leads:0,worked:0,wins:0,showroom:0}]));
  const sellers=new Map(sellerData.sellers.map(x=>[String(x.sucursal_id)+':'+String(x.persona_id),{leads:0,worked:0,wins:0,showroom:0}]));
  const names=new Map(users.map(x=>[x.id,x.name]));
  // Exact validated aliases take precedence; only complete token signatures may fall back.
  // The current Azure roster remains the sole authority for displayed sellers.
  const fold=x=>norm(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const signature=x=>fold(x).split(' ').filter(Boolean).sort().join(' ');
  const ownerMatches=owner=>{
    const name=names.get(owner);
    if(!name||!fold(name))return [];
    const candidates=sellerData.aliases.filter(a=>a.alias&&sellers.has(String(a.sucursal_id)+':'+String(a.persona_id)));
    const exact=candidates.filter(a=>norm(a.alias)===norm(name));
    if(exact.length)return exact;
    const normalized=candidates.filter(a=>fold(a.alias)===fold(name));
    if(normalized.length)return normalized;
    return candidates.filter(a=>signature(a.alias)===signature(name));
  };
  const addLead=(t,row)=>{if(!t)return;t.leads+=row.count;if(row.status&&row.status!=='Nuevo')t.worked+=row.count;if(row.origin==='SHOWROOM')t.showroom+=row.count};
  let unresolvedLeads=0,unresolvedWins=0;
  const ownerBranches=new Map();
  for(const row of leads){
    const sid=unique(aliases.filter(a=>norm(a.alias)===norm(row.branch)&&row.branch).map(a=>a.id));
    // Preserve non-store evidence too: do not silently assign Administration or dealers to a store.
    if(row.branch){
      if(!ownerBranches.has(row.owner))ownerBranches.set(row.owner,new Set());
      ownerBranches.get(row.owner).add(sid??'UNRESOLVED:'+norm(row.branch));
    }
    if(!stores.has(sid)){unresolvedLeads+=row.count;continue;}
    addLead(stores.get(sid),row);
    const pid=unique(ownerMatches(row.owner).filter(a=>String(a.sucursal_id)===sid).map(a=>String(a.persona_id)));
    addLead(sellers.get(sid+':'+pid),row);
  }
  for(const row of wins){
    const matches=ownerMatches(row.owner);
    const observed=[...(ownerBranches.get(row.owner)||[])];
    // Opportunity has no branch field. Use the unique CRM lead branch, or the
    // unambiguous active Azure assignment when no CRM branch was observed.
    const sid=observed.length?unique(observed):unique(matches.map(a=>String(a.sucursal_id)));
    if(!stores.has(sid)){unresolvedWins+=row.count;continue;}
    stores.get(sid).wins+=row.count;
    const pid=unique(matches.filter(a=>String(a.sucursal_id)===sid).map(a=>String(a.persona_id)));
    const seller=sellers.get(sid+':'+pid);
    if(seller)seller.wins+=row.count;
  }
  return {stores,sellers,unresolvedLeads,unresolvedWins};
}

async function performRefresh(weekStart, cutoffDate, origin, job, env) {
    const branches = await call(getBranches, `${origin}/api/weekly-projections/sucursales`);
    if (!Array.isArray(branches.sucursales) || !branches.sucursales.length) throw new Error('No se recibieron tiendas para calcular los resultados');
    const rows = [];
    const scopeIds = branches.sucursales.map(store => String(store.sucursal_id));
    const scopeQuery = encodeURIComponent(scopeIds.join(','));
    const period = cutoffDate.slice(0, 7);
    const previousMonthDate = new Date(Date.UTC(Number(period.slice(0,4)), Number(period.slice(5,7)) - 2, Math.min(Number(cutoffDate.slice(8,10)), new Date(Date.UTC(Number(period.slice(0,4)), Number(period.slice(5,7)) - 1, 0)).getUTCDate())));
    const previousMonthCutoff = previousMonthDate.toISOString().slice(0,10);
    const previousMonthEnd = new Date(Date.UTC(Number(period.slice(0,4)), Number(period.slice(5,7)) - 1, 0)).toISOString().slice(0,10);
    const previousMonday = new Date(previousMonthCutoff+'T12:00:00Z');
    previousMonday.setUTCDate(previousMonday.getUTCDate()-((previousMonday.getUTCDay()+6)%7));
    const previousWeekStart = previousMonday.toISOString().slice(0,10);
    const [companyAdmin, companyFinance, sellerData, precurseBundle, previousMonthAdmin, previousFullMonthAdmin] = await Promise.all([
      call(getAdmin, `${origin}/api/weekly-projections/admin?week_start=${weekStart}&cutoff_date=${cutoffDate}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getCompanyFinance, `${origin}/api/weekly-projections/company-finance?cutoff_date=${cutoffDate}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getForumSellers, `${origin}/api/weekly-projections/forum-sellers?all_stores=1&cutoff_date=${cutoffDate}`),
      getPrecurseBundle(),
      call(getAdmin, `${origin}/api/weekly-projections/admin?week_start=${previousWeekStart}&cutoff_date=${previousMonthCutoff}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getAdmin, `${origin}/api/weekly-projections/admin?week_start=${previousWeekStart}&cutoff_date=${previousMonthEnd}&include_scopes=1&scope_ids=${scopeQuery}`),
    ]);
    requireAdmin(companyAdmin, 'COMPANY');
    requireFinance(companyFinance, 'COMPANY');
    requireArray(sellerData.aliases, 'SELLER_ALIASES');
    requireArray(sellerData.forum, 'SELLER_FORUM');
    requireArray(sellerData.sellers, 'SELLER_ROSTER');
    if (!companyAdmin.scopes || !companyFinance.scopes || !previousFullMonthAdmin.scopes) throw new Error('Incomplete grouped store results');

    let crm=null;
    try { crm=await getCrmSnapshot(cutoffDate,branches.sucursales,sellerData,job.job_id); } catch(error) { console.error('CRM snapshot unavailable:',error.message); }
    const brandIndicators = await getP1BrandIndicators(period, cutoffDate, scopeIds, job.job_id);
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

    // Persist a compact model/family breakdown alongside the existing snapshot.
    // The detailed live projection and pending-shipment endpoints remain unchanged.
    const productRows = await db().query(`
      SELECT kind, sucursal_id::text, modelo_id::text, marca_id::text, marca, modelo, familia,
             SUM(units)::bigint AS units
      FROM (
        SELECT 'PROJECTION' AS kind, p.sucursal_id, p.modelo_id, m.marca_id,
               COALESCE(ma.nombre_canonico, 'Sin marca') AS marca, COALESCE(m.nombre_canonico, 'Sin modelo') AS modelo, m.familia,
               p.projected_units AS units
        FROM weekly_sales_projection p
        LEFT JOIN modelos_master_v01 m ON m.modelo_id=p.modelo_id
        LEFT JOIN marcas_master_v01 ma ON ma.marca_id=m.marca_id
        WHERE p.week_start=$1::date
        UNION ALL
        SELECT 'SENT_NOT_INVOICED', x.sucursal_id, x.modelo_id, m.marca_id,
               COALESCE(ma.nombre_canonico, 'Sin marca'), COALESCE(m.nombre_canonico, 'Sin modelo'), m.familia, x.units
        FROM sales_sent_not_invoiced x
        LEFT JOIN modelos_master_v01 m ON m.modelo_id=x.modelo_id
        LEFT JOIN marcas_master_v01 ma ON ma.marca_id=m.marca_id
        WHERE x.status='PENDING'
          AND COALESCE(x.week_start, date_trunc('week', x.sent_at AT TIME ZONE 'America/Santiago')::date)=$1::date
      ) detail
      GROUP BY kind,sucursal_id,modelo_id,marca_id,marca,modelo,familia
      ORDER BY sucursal_id,kind,marca,modelo
    `, [weekStart]);
    const breakdown = productRows.map(row => ({ kind: row.kind, sucursal_id: String(row.sucursal_id),
      modelo_id: String(row.modelo_id), marca_id: String(row.marca_id), marca: row.marca,
      modelo: row.modelo, familia: row.familia, units: Number(row.units) }));
    const byStoreBreakdown = storeId => breakdown.filter(row => row.sucursal_id === storeId);
    const expectedProjection = Number(companyAdmin.summary?.total_units);
    const expectedSent = Number(companyAdmin.summary?.sent_not_invoiced_units);
    if (!Number.isSafeInteger(expectedProjection) || !Number.isSafeInteger(expectedSent) ||
        breakdown.filter(row => row.kind === 'PROJECTION').reduce((n, row) => n + row.units, 0) !== expectedProjection ||
        breakdown.filter(row => row.kind === 'SENT_NOT_INVOICED').reduce((n, row) => n + row.units, 0) !== expectedSent)
      throw new Error('PRODUCT_BREAKDOWN_TOTAL_MISMATCH');
    companyAdmin.previous_full_month_units = previousFullMonthAdmin.sales_mtd.total_units;
    companyAdmin.product_breakdown = breakdown;
    const storeAdminScopes = companyAdmin.scopes, storeFinanceScopes = companyFinance.scopes;
    delete companyAdmin.scopes;
    delete companyFinance.scopes;
    delete companyAdmin.projections;
    delete companyAdmin.sent_not_invoiced;
    // Historical YOY details stay in historical_context.periods for company and every store.
    companyAdmin.sales_mtd.details = companyAdmin.sales_mtd.details.map(({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta, marca }) => ({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta, marca }));
    rows.push(resultRow({ weekStart, cutoffDate, env, dimension: 'COMPANY', scopeKey: 'COMPANY', payload: { admin: companyAdmin, companyFinance } }));

    job.totalStores = branches.sucursales.length;
    await snapshots.update(weekStart, cutoffDate, env, job);
    let completedStores = 0;
    for (const store of branches.sucursales) {
      const storeId = String(store.sucursal_id);
      const admin = storeAdminScopes[storeId], finance = storeFinanceScopes[storeId];
      if (!admin || !finance) throw new Error(`Missing grouped result for store ${storeId}`);
      admin.product_breakdown = byStoreBreakdown(storeId);
      delete admin.projections;
      delete admin.sent_not_invoiced;
      admin.sales_mtd.details = admin.sales_mtd.details.map(({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta, marca }) => ({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta, marca }));
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
      const fullMonthSales = previousFullMonthAdmin.scopes?.[storeId]?.sales_mtd?.details;
      const previousFullMonthSales = Array.isArray(fullMonthSales) && fullMonthSales.length === previousFullMonthAdmin.scopes?.[storeId]?.sales_mtd?.total_units ? fullMonthSales.map(({persona_id,vendedor,vendedor_nombre})=>({persona_id,vendedor,vendedor_nombre})) : null;
      rows.push(resultRow({ weekStart, cutoffDate, env, dimension: 'STORE', scopeKey: `STORE:${storeId}`, storeId, payload: { admin: { ...admin, previous_month_sales: previousMonthSales.map(({ vin, persona_id, vendedor, vendedor_nombre }) => ({ vin, persona_id, vendedor, vendedor_nombre })), previous_full_month_sales: previousFullMonthSales, previous_full_month_units: previousFullMonthAdmin.scopes?.[storeId]?.sales_mtd?.total_units ?? null }, companyFinance: finance, aliases, crm: crm?.stores.get(storeId)??null } }));
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
        rows.push(resultRow({ weekStart, cutoffDate, env, dimension: 'SELLER', scopeKey: `SELLER:${storeId}:${sellerId}`, storeId, personId: sellerId, payload: { forum, crm: crm?.sellers.get(storeId+':'+sellerId)??null } }));
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
