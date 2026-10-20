import { NextResponse } from 'next/server';
import { db, withDbTransaction } from '../../../../lib/db.js';
import { GET as getAdmin } from '../admin/route.js';
import { GET as getCompanyFinance } from '../company-finance/route.js';
import { GET as getForumSellers } from '../forum-sellers/route.js';
import { GET as getBranches } from '../sucursales/route.js';
import { GET as getProjections } from '../projections/route.js';
import { GET as getNotInvoiced } from '../not-invoiced/route.js';

export const dynamic = 'force-dynamic';

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

function p1BrandIndicator(id, evidence, source, companyValue) {
  if (evidence?.authority !== 'P1_CERTIFIED' || !evidence.evidence_id ||
      !['COMPLETE', 'CERTIFIED'].includes(evidence.status) || !Array.isArray(evidence?.payload?.members)) {
    throw new Error('P1 brand evidence is not certified: ' + id);
  }
  const values = { foton: 0, dongfeng: 0 };
  for (const member of evidence.payload.members) {
    const grouped = Array.isArray(member.members) ? member.members : [];
    const network = grouped.find(item => item.dimension === 'NETWORK')?.member_label;
    if (network && network !== 'TIENDA_PROPIA') continue;
    const brand = grouped.find(item => item.dimension === 'BRAND')?.member_label ??
      String(member.member_label ?? '').trim().toUpperCase();
    const amount = Number(member.value);
    if (!Number.isFinite(amount)) continue;
    if (brand === 'FOTON') values.foton += amount;
    if (['DONGFENG', 'DFM'].includes(brand)) values.dongfeng += amount;
  }
  const company = Number(companyValue ?? evidence.coverage?.total_value ?? evidence.coverage?.filtered_n);
  if (!Number.isFinite(company)) throw new Error('P1 total is missing for ' + id);
  return {
    company,
    foton: values.foton,
    dongfeng: values.dongfeng,
    cutoff: evidence.temporal?.snapshot_date || evidence.temporal?.cutoff || evidence.temporal?.to || null,
    evidence_ids: [evidence.evidence_id],
    source: source + ' P1',
  };
}

function p1FinanceByBrand(id, evidence) {
  if (evidence?.authority !== 'P1_CERTIFIED' || !evidence.evidence_id ||
      !['COMPLETE', 'CERTIFIED'].includes(evidence.status) || !Array.isArray(evidence?.payload?.members)) {
    throw new Error('P1 financial-entity evidence is not certified: ' + id);
  }
  let ufi = 0, other = 0;
  for (const member of evidence.payload.members) {
    const entity = String(member.member_id ?? member.member_label ?? '').trim().toUpperCase();
    const amount = Number(member.value || 0);
    if (entity === 'FORUM') ufi += amount;
    else if (entity && entity !== 'UNRESOLVED' && !entity.includes('NO RESUELTO')) other += amount;
  }
  return { ufi, other, evidence_id: evidence.evidence_id };
}

function p1OwnStoreSales(id, evidence) {
  if (evidence?.authority !== 'P1_CERTIFIED' || !evidence.evidence_id ||
      !['COMPLETE', 'CERTIFIED'].includes(evidence.status) || !Array.isArray(evidence?.payload?.members)) {
    throw new Error('P1 own-store sales evidence is not certified: ' + id);
  }
  const ownStores = evidence.payload.members
    .filter(member => String(member.member_id ?? member.member_label ?? '').trim().toUpperCase() === 'TIENDA_PROPIA')
    .reduce((value, member) => value + Number(member.value || 0), 0);
  return { total: ownStores, evidence_id: evidence.evidence_id };
}

function shiftDate(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function getP1BrandIndicators(period, cutoffDate, storeId = null, forumStoreAliases = []) {
  if (storeId && !forumStoreAliases.length) throw new Error('P1_FORUM_STORE_ALIAS_MISSING: ' + storeId);
  const scope = storeId ? '-store-' + storeId : '';
  const runId = 'weekly-projection-brands-' + period + '-' + cutoffDate + scope;
  const network = {
    network: ['OWN_STORES'],
    ...(storeId ? { store: forumStoreAliases } : {}),
  };
  const weekFrom = shiftDate(cutoffDate, -6);
  const salesBrandArgs = (brandId, from, to, dimension) => ({
    source: 'SALES', measure: 'VIN_SALES', evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET',
    dimension, filters: { brand_id: brandId, commercial_universe: 'OWN_STORES', date_from: from, date_to: to, ...(storeId ? { store_id: storeId } : {}) },
    cutoff: to,
  });
  const [salesResult, quotesEvidence, approvedEvidence, precurseEvidence] = await Promise.all([
    storeId
      ? callP1Tool(runId, 'data_observe', {
        source: 'SALES', measure: 'VIN_SALES', evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET',
        period_from: period, period_to: period, cutoff: cutoffDate, dimension: 'NETWORK',
        filters: { commercial_universe: 'OWN_STORES', store_id: storeId },
      })
      : callP1Tool(runId, 'sales_observe_many', {
        measure: 'VIN_SALES', period, cutoff: cutoffDate, commercial_universe: 'OWN_STORES',
        operations: [{ kind: 'BRAND_NETWORK' }],
      }),
    callP1Tool(runId, 'data_observe', {
      source: 'FORUM', measure: 'QUOTATIONS', evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET',
      period_from: period, period_to: period, cutoff: cutoffDate, dimension: 'BRAND', filters: network,
    }),
    callP1Tool(runId, 'data_observe', {
      source: 'FORUM', measure: 'COHORT_APPROVED', evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET',
      period_from: period, period_to: period, cutoff: cutoffDate, dimension: 'BRAND', filters: network,
    }),
    callP1Tool(runId, 'data_observe', {
      source: 'FORUM', measure: 'PRECURSE', evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET',
      dimension: 'BRAND', filters: network,
    }),
  ]);
  const storeMonthlyBrandEvidence = storeId
    ? await Promise.all(['89', '71'].map(brandId => callP1Tool(runId, 'data_observe', {
      source: 'SALES', measure: 'VIN_SALES', evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET',
      period, cutoff: cutoffDate, dimension: 'NETWORK',
      filters: { brand_id: brandId, commercial_universe: 'OWN_STORES', store_id: storeId },
    })))
    : null;
  const [fotonOther, dongfengOther] = await Promise.all([
    callP1Tool(runId, 'data_observe', {
      source: 'SALES', measure: 'VIN_SALES', evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET',
      dimension: 'FINANCIAL_ENTITY', period, cutoff: cutoffDate,
      filters: { brand_id: '89', commercial_universe: 'OWN_STORES', ...(storeId ? { store_id: storeId } : {}) },
    }),
    callP1Tool(runId, 'data_observe', {
      source: 'SALES', measure: 'VIN_SALES', evidence_shape: 'DIMENSIONAL_QUANTITATIVE_DATASET',
      dimension: 'FINANCIAL_ENTITY', period, cutoff: cutoffDate,
      filters: { brand_id: '71', commercial_universe: 'OWN_STORES', ...(storeId ? { store_id: storeId } : {}) },
    }),
  ]);
  const [fotonWeek, dongfengWeek] = await Promise.all([
    callP1Tool(runId, 'data_observe', salesBrandArgs('89', weekFrom, cutoffDate, 'NETWORK')),
    callP1Tool(runId, 'data_observe', salesBrandArgs('71', weekFrom, cutoffDate, 'NETWORK')),
  ]);
  const companySalesEvidence = storeId
    ? salesResult
    : salesResult?.results?.find(item => item?.operation?.kind === 'BRAND_NETWORK')?.evidence;
  let salesEvidence = companySalesEvidence;
  if (storeId) {
    const [fotonMonthly, dongfengMonthly] = storeMonthlyBrandEvidence.map((evidence, index) =>
      p1OwnStoreSales(index === 0 ? 'FOTON' : 'DONGFENG', evidence));
    const companyMonthly = p1OwnStoreSales('store sales', companySalesEvidence);
    salesEvidence = {
      ...companySalesEvidence,
      coverage: { ...companySalesEvidence.coverage, filtered_n: companyMonthly.total },
      payload: {
        ...companySalesEvidence.payload,
        members: [
          { member_label: 'FOTON', value: fotonMonthly.total },
          { member_label: 'DONGFENG', value: dongfengMonthly.total },
        ],
      },
      _brandEvidenceIds: [fotonMonthly.evidence_id, dongfengMonthly.evidence_id],
    };
  }
  if (!salesEvidence) throw new Error('P1 sales brand evidence is missing');
  const fotonWeekly = p1OwnStoreSales('FOTON', fotonWeek);
  const dongfengWeekly = p1OwnStoreSales('DONGFENG', dongfengWeek);
  const fotonFinance = p1FinanceByBrand('FOTON', fotonOther);
  const dongfengFinance = p1FinanceByBrand('DONGFENG', dongfengOther);
  return {
    sales: {
      ...p1BrandIndicator('sales', salesEvidence, 'SALES', salesEvidence.coverage?.filtered_n),
      ...(storeId ? { evidence_ids: [salesEvidence.evidence_id, ...salesEvidence._brandEvidenceIds] } : {}),
    },
    quotations: p1BrandIndicator('quotations', quotesEvidence, 'FORUM', quotesEvidence.coverage?.total_value),
    approved: p1BrandIndicator('approved', approvedEvidence, 'FORUM', approvedEvidence.coverage?.total_value),
    other_credits: {
      foton: fotonFinance.other,
      dongfeng: dongfengFinance.other,
      source: 'SALES P1', cutoff: cutoffDate,
      evidence_ids: [fotonFinance.evidence_id, dongfengFinance.evidence_id],
    },
    weekly_sales: {
      foton: fotonWeekly.total,
      dongfeng: dongfengWeekly.total,
      company: fotonWeekly.total + dongfengWeekly.total,
      source: 'SALES P1', cutoff: cutoffDate, date_from: weekFrom,
      evidence_ids: [fotonWeek.evidence_id, dongfengWeek.evidence_id],
    },
    ufis: {
      foton: fotonFinance.ufi,
      dongfeng: dongfengFinance.ufi,
      company: fotonFinance.ufi + dongfengFinance.ufi,
      source: 'SALES P1', cutoff: cutoffDate,
      evidence_ids: [fotonFinance.evidence_id, dongfengFinance.evidence_id],
    },
    precurse: p1BrandIndicator('precurse', precurseEvidence, 'FORUM', precurseEvidence.coverage?.total_value),
  };
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
      SELECT sucursal_id::text AS sucursal_id, payload->'admin'->'sales_mtd'->>'total_units' AS total_units
      FROM weekly_projection_results
      WHERE week_start=${weekStart}::date AND cutoff_date=${cutoffDate}::date AND environment=${env}
        AND dimension='STORE'
    ` : [];
    const branches = await call(getBranches, `${url.origin}/api/weekly-projections/sucursales`);
    const scopeStores = storeId ? branches.sucursales.filter(s => String(s.sucursal_id) === storeId) : branches.sucursales;
    if (!scopeStores.length) throw new Error('No fue posible resolver la tienda del resultado');

    // Three live reads for the whole selected scope instead of N requests per store.
    const scopeNames = new Map(scopeStores.map(store => [String(store.sucursal_id), store.nombre_canonico]));
    const previousCut = cached.payload.admin.evolution?.previous_cut || null;
    const [currentProjections, sentRows, previousProjections] = await Promise.all([
      sql`SELECT wsp.projection_id::text,wsp.week_start::text,wsp.sucursal_id::text,wsp.persona_id::text,
        COALESCE(p.nombre_canonico,p.usuario_canonico,wsp.source_vendedor_raw,'Sin vendedor') vendedor,
        wsp.modelo_id::text,wsp.version_id::text,vm.nombre_canonico version,
        COALESCE(ma.nombre_canonico,wsp.source_brand_raw,'Sin marca') marca,
        COALESCE(m.nombre_canonico,wsp.source_model_raw,'Sin modelo') modelo,
        wsp.projected_units,wsp.expected_close_date::text,wsp.crm_opportunity_id,wsp.crm_link_method,wsp.updated_at
        FROM weekly_sales_projection wsp
        LEFT JOIN personas_master p ON p.persona_id=wsp.persona_id
        LEFT JOIN modelos_master_v01 m ON m.modelo_id=wsp.modelo_id
        LEFT JOIN versiones_master_v01 vm ON vm.version_id=wsp.version_id
        LEFT JOIN marcas_master_v01 ma ON ma.marca_id=m.marca_id
        WHERE wsp.week_start=${weekStart}::date ${storeId ? sql`AND wsp.sucursal_id=${storeId}::bigint` : sql``}
        ORDER BY vendedor,expected_close_date,marca,modelo,wsp.projection_id`,
      sql`SELECT x.sent_not_invoiced_id::text,x.sucursal_id::text,x.persona_id::text,
        COALESCE(p.nombre_canonico,wps.nombre,'Sin vendedor') vendedor,
        x.units,x.status,x.sent_at,x.resolved_at,x.modelo_id::text,x.crm_opportunity_id,x.crm_link_method,
        COALESCE(ma.nombre_canonico,'Sin marca') marca,COALESCE(mm.nombre_canonico,'Sin modelo') modelo
        FROM sales_sent_not_invoiced x
        LEFT JOIN personas_master p ON p.persona_id=x.persona_id
        LEFT JOIN weekly_projection_sellers wps ON wps.persona_id=x.persona_id AND wps.sucursal_id=x.sucursal_id
        LEFT JOIN modelos_master_v01 mm ON mm.modelo_id=x.modelo_id
        LEFT JOIN marcas_master_v01 ma ON ma.marca_id=mm.marca_id
        WHERE x.status='PENDING'
          AND COALESCE(x.week_start,date_trunc('week',x.sent_at AT TIME ZONE 'America/Santiago')::date)=${weekStart}::date
          ${storeId ? sql`AND x.sucursal_id=${storeId}::bigint` : sql``}
        ORDER BY x.sent_at DESC,x.sent_not_invoiced_id DESC`,
      previousCut ? sql`SELECT sucursal_id::text AS sucursal_id, projected_units
        FROM weekly_sales_projection WHERE week_start=${previousCut}::date
        ${storeId ? sql`AND sucursal_id=${storeId}::bigint` : sql``}` : Promise.resolve([]),
    ]);
    const projections = currentProjections.filter(row => scopeNames.has(String(row.sucursal_id)))
      .map(row => ({ ...row, sucursal: scopeNames.get(String(row.sucursal_id)) }));
    const sent = sentRows.filter(row => scopeNames.has(String(row.sucursal_id)))
      .map(row => ({ ...row, sucursal: scopeNames.get(String(row.sucursal_id)) }));
    const payload = cached.payload.admin;
    payload.projections = projections;
    payload.sent_not_invoiced = sent;
    payload.summary = { total_units: sum(projections, 'projected_units'), sent_not_invoiced_units: sum(sent, 'units') };
    const current = payload.historical_context.periods.find(p => p.label === 'CURRENT');
    payload.next_cut_context.expected_units = Number(current.mtd_units || 0) + payload.summary.total_units;

    // The current cut's live projections also feed the previous-cut comparison.
    if (payload.evolution?.previous_cut) {
      const old = new Map();
      for (const row of previousProjections) {
        const sid = String(row.sucursal_id);
        if (scopeNames.has(sid)) old.set(sid, (old.get(sid) || 0) + Number(row.projected_units || 0));
      }
      const previousTotal = [...old.values()].reduce((total, units) => total + units, 0);
      payload.evolution.previous_projection = previousTotal;
      payload.evolution.expected_current = Number(payload.evolution.previous_sales_mtd || 0) + previousTotal;
      if (payload.evolution.stores?.length) {
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
      storeSales: storeSales.map(r => ({ sucursal_id: r.sucursal_id, total_units: Number(r.total_units || 0) })),
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

const REFRESH_STATUS_SCOPE = 'REFRESH_STATUS';
function refreshKey(weekStart, cutoffDate, env) { return `${weekStart}:${cutoffDate}:${env}`; }


async function readRefreshStatus(weekStart, cutoffDate, env) {
  try {
    const sql = db();
    const rows = await sql.query(`
      SELECT payload FROM weekly_projection_results
      WHERE week_start=$1::date AND cutoff_date=$2::date AND environment=$3 AND scope_key=$4
    `, [weekStart, cutoffDate, env, REFRESH_STATUS_SCOPE]);
    return rows[0]?.payload || { status: 'idle' };
  } catch (error) {
    if (error?.code === '42P01') return { status: 'idle' };
    throw error;
  }
}

async function writeRefreshStatus(weekStart, cutoffDate, env, job, claim = false, progress = false) {
  const sql = db();
  const query = `
    INSERT INTO weekly_projection_results
      (week_start,cutoff_date,environment,dimension,scope_key,payload,updated_at)
    VALUES ($1::date,$2::date,$3,'COMPANY',$4,$5::jsonb,now())
    ON CONFLICT (week_start,cutoff_date,environment,scope_key) DO UPDATE
      SET payload = CASE WHEN $6::boolean THEN
        EXCLUDED.payload || jsonb_build_object(
          'completedStores',
          GREATEST(
            COALESCE((weekly_projection_results.payload->>'completedStores')::integer, 0),
            COALESCE((EXCLUDED.payload->>'completedStores')::integer, 0)
          )
        )
        ELSE EXCLUDED.payload END,
        updated_at=now()
      ${claim ? "WHERE weekly_projection_results.payload->>'status' IS DISTINCT FROM 'running'" : ''}
    RETURNING payload
  `;
  const rows = await sql.query(query, [weekStart, cutoffDate, env, REFRESH_STATUS_SCOPE, JSON.stringify(job), progress]);
  return rows[0]?.payload || null;
}

async function performRefresh(weekStart, cutoffDate, origin, job, env) {
    const branches = await call(getBranches, `${origin}/api/weekly-projections/sucursales`);
    if (!Array.isArray(branches.sucursales) || !branches.sucursales.length) throw new Error('No se recibieron tiendas para calcular los resultados');
    const rows = [];
    const scopeIds = branches.sucursales.map(store => String(store.sucursal_id));
    const scopeQuery = encodeURIComponent(scopeIds.join(','));
    const period = cutoffDate.slice(0, 7);
    const [companyAdmin, companyFinance, sellerData, precurseBundle, brandIndicators] = await Promise.all([
      call(getAdmin, `${origin}/api/weekly-projections/admin?week_start=${weekStart}&cutoff_date=${cutoffDate}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getCompanyFinance, `${origin}/api/weekly-projections/company-finance?cutoff_date=${cutoffDate}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getForumSellers, `${origin}/api/weekly-projections/forum-sellers?all_stores=1&cutoff_date=${cutoffDate}`),
      getPrecurseBundle(),
      getP1BrandIndicators(period, cutoffDate),
    ]);
    requireAdmin(companyAdmin, 'COMPANY');
    requireFinance(companyFinance, 'COMPANY');
    requireArray(sellerData.aliases, 'SELLER_ALIASES');
    requireArray(sellerData.forum, 'SELLER_FORUM');
    requireArray(sellerData.sellers, 'SELLER_ROSTER');
    if (!companyAdmin.scopes || !companyFinance.scopes) throw new Error('Incomplete grouped store results');

    companyAdmin.brand_indicators = brandIndicators;
    companyFinance.brand_indicators = brandIndicators;

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
    companyAdmin.sales_mtd.details = companyAdmin.sales_mtd.details.map(({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta }) => ({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta }));
    rows.push(resultRow({ weekStart, cutoffDate, env, dimension: 'COMPANY', scopeKey: 'COMPANY', payload: { admin: companyAdmin, companyFinance } }));

    job.totalStores = branches.sucursales.length;
    await writeRefreshStatus(weekStart, cutoffDate, env, job);
    let completedStores = 0;
    for (const store of branches.sucursales) {
      const storeId = String(store.sucursal_id);
      const admin = storeAdminScopes[storeId], finance = storeFinanceScopes[storeId];
      if (!admin || !finance) throw new Error(`Missing grouped result for store ${storeId}`);
      const forumAliasRows = await db()`
        SELECT DISTINCT valor_raw
        FROM sucursal_aliases
        WHERE sucursal_id=${storeId}::bigint
          AND fuente='forum_raw'
          AND validated=true
          AND valor_raw IS NOT NULL
        ORDER BY valor_raw
      `;
      const forumStoreAliases = forumAliasRows.map(row => String(row.valor_raw).trim()).filter(Boolean);
      const storeBrandIndicators = await getP1BrandIndicators(period, cutoffDate, storeId, forumStoreAliases);
      admin.brand_indicators = storeBrandIndicators;
      finance.brand_indicators = storeBrandIndicators;
      delete admin.projections;
      delete admin.sent_not_invoiced;
      admin.sales_mtd.details = admin.sales_mtd.details.map(({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta }) => ({ vin, sucursal_id, sucursal, vendedor, persona_id, vendedor_nombre, entidad_financiera, fecha_venta }));
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
      rows.push(resultRow({ weekStart, cutoffDate, env, dimension: 'STORE', scopeKey: `STORE:${storeId}`, storeId, payload: { admin, companyFinance: finance, aliases } }));
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
      await writeRefreshStatus(weekStart, cutoffDate, env, job, false, true);
    }

    const finishedAt = new Date().toISOString();
    const completedJob = { ...job, status: 'completed', finished_at: finishedAt, duration_ms: Date.now() - Date.parse(job.started_at) };
    await withDbTransaction(async client => {
      await client.query(
        'DELETE FROM weekly_projection_results WHERE week_start=$1::date AND cutoff_date=$2::date AND environment=$3',
        [weekStart, cutoffDate, env],
      );
      for (const row of rows) {
        await client.query(
          `INSERT INTO weekly_projection_results
            (week_start,cutoff_date,environment,dimension,scope_key,sucursal_id,persona_id,payload,updated_at)
           VALUES ($1::date,$2::date,$3,$4,$5,$6::bigint,$7::bigint,$8::jsonb,now())`,
          [row.weekStart, row.cutoffDate, row.env, row.dimension, row.scopeKey, row.storeId, row.personId, JSON.stringify(row.payload)],
        );
      }
      await client.query(
        `INSERT INTO weekly_projection_results
          (week_start,cutoff_date,environment,dimension,scope_key,payload,updated_at)
         VALUES ($1::date,$2::date,$3,'COMPANY',$4,$5::jsonb,now())`,
        [weekStart, cutoffDate, env, REFRESH_STATUS_SCOPE, JSON.stringify(completedJob)],
      );
    });
    return { ok: true, week_start: weekStart, cutoff_date: cutoffDate, environment: env, results: rows.length, updated_at: finishedAt, ...completedJob };
}

export async function POST(request) {
  let weekStart, cutoffDate, job, env;
  try {
    env = environment();
    const body = await request.json();
    ({ weekStart, cutoffDate } = dates(new URLSearchParams({ week_start: body.week_start || '', cutoff_date: body.cutoff_date || '' })));
    job = { status: 'running', week_start: weekStart, cutoff_date: cutoffDate, completedStores: 0, totalStores: 0, started_at: new Date().toISOString() };
    const claimed = await writeRefreshStatus(weekStart, cutoffDate, env, job, true);
    if (!claimed) {
      return NextResponse.json({ ok: true, queued: true, environment: env, ...(await readRefreshStatus(weekStart, cutoffDate, env)) }, { status: 202 });
    }
    const origin = new URL(request.url).origin;
    const result = await performRefresh(weekStart, cutoffDate, origin, job, env);
    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    if (job && weekStart && cutoffDate) {
      const failed = { ...job, status: 'failed', error: error?.message || 'No fue posible actualizar los resultados', finished_at: new Date().toISOString() };
      try { if (env) await writeRefreshStatus(weekStart, cutoffDate, env, failed); } catch (statusError) { console.error(statusError); }
      return NextResponse.json({ ok: false, ...failed }, { status: 500 });
    }
    return bad(error?.message || 'Internal server error', 400);
  }
}
