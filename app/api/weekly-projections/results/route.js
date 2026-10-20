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
      SET payload = CASE WHEN $5::boolean THEN
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
    const [companyAdmin, companyFinance, sellerData, precurseBundle] = await Promise.all([
      call(getAdmin, `${origin}/api/weekly-projections/admin?week_start=${weekStart}&cutoff_date=${cutoffDate}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getCompanyFinance, `${origin}/api/weekly-projections/company-finance?cutoff_date=${cutoffDate}&include_scopes=1&scope_ids=${scopeQuery}`),
      call(getForumSellers, `${origin}/api/weekly-projections/forum-sellers?all_stores=1&cutoff_date=${cutoffDate}`),
      getPrecurseBundle(),
    ]);
    requireAdmin(companyAdmin, 'COMPANY');
    requireFinance(companyFinance, 'COMPANY');
    requireArray(sellerData.aliases, 'SELLER_ALIASES');
    requireArray(sellerData.forum, 'SELLER_FORUM');
    requireArray(sellerData.sellers, 'SELLER_ROSTER');
    if (!companyAdmin.scopes || !companyFinance.scopes) throw new Error('Incomplete grouped store results');

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
