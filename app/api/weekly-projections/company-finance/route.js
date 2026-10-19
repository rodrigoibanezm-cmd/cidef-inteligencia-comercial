import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { withDailyReportSnapshot } from '../../../../lib/daily-report-snapshot.js';
import { withP1Mcp, callP1 } from '../../../../lib/p1-client.js';

export const dynamic = 'force-dynamic';

function priorCutoff(cutoff, offset) {
  const day = Number(cutoff.slice(8, 10));
  const d = new Date(`${cutoff.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const year = d.getUTCFullYear(), month = d.getUTCMonth();
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, monthEnd)).padStart(2, '0')}`;
}
function financeCounts(evidence, storeId = null) {
  const counts = { ufi: 0, otros: 0, unresolved: 0 };
  const grouped = evidence?.results?.find(row => row.operation?.kind === 'STORE_FINANCIAL_ENTITY')?.evidence;
  const data = grouped || evidence;
  if (!Array.isArray(data?.payload?.members)) {
    throw new Error('SALES P1 STORE_FINANCIAL_ENTITY returned incomplete evidence');
  }
  const members = data.payload.members;
  for (const member of members) {
    const entityId = grouped
      ? member.members?.find(item => item.dimension === 'FINANCIAL_ENTITY')?.member_id
      : member.member_id;
    const memberStore = grouped
      ? member.members?.find(item => item.dimension === 'STORE')?.member_id
      : null;
    if (storeId && String(memberStore) !== String(storeId)) continue;
    const entity = String(entityId ?? '').trim().toUpperCase();
    if (member.value == null || !Number.isFinite(Number(member.value))) {
      throw new Error('SALES P1 STORE_FINANCIAL_ENTITY returned a member without a numeric value');
    }
    const value = Number(member.value);
    if (entity === 'UNRESOLVED' || !entity) counts.unresolved += value;
    else if (entity === 'FORUM') counts.ufi += value;
    else counts.otros += value;
  }
  return counts;
}
function memberId(row, dimension) {
  return row.members?.find(member => member.dimension === dimension)?.member_id ?? null;
}

async function calculate(request) {
  let currentStep='request validation';
  try {
    const params = new URL(request.url).searchParams;
    const cutoff = params.get('cutoff_date');
    const storeId = params.get('sucursal_id') || null;
    if (storeId && !/^\d+$/.test(storeId)) return NextResponse.json({ok:false,error:'Invalid sucursal_id'},{status:400});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff || '') ||
        Number.isNaN(Date.parse(cutoff)) || new Date(cutoff).toISOString().slice(0,10)!==cutoff) {
      return NextResponse.json({ok:false,error:'Invalid cutoff_date'}, {status:400});
    }
    const periods = [-3,-2,-1,0].map((n,i) => {
      const periodCutoff = priorCutoff(cutoff,n);
      return {label:i===3?'CURRENT':`M-${-n}`,month:periodCutoff.slice(0,7),cutoff_date:periodCutoff,
        date_from:periodCutoff.slice(0,7)+'-01'};
    });
    const sql = db();
    currentStep='Azure PostgreSQL store aliases';
    const storeAliasRows = await sql`
      WITH candidates AS (
        SELECT upper(trim(a.valor_raw)) alias,s.sucursal_id::text store_id
        FROM sucursal_aliases a
        JOIN sucursales_master s ON s.sucursal_id=a.sucursal_id
        WHERE a.validated=true AND a.fuente='forum_raw' AND s.tipo_canal='CIDEF'
          AND s.vigente=true AND lower(trim(s.nombre_canonico))<>'casa matriz'
          AND nullif(trim(a.valor_raw),'') IS NOT NULL
      ), unique_aliases AS (
        SELECT alias,min(store_id)::text store_id FROM candidates
        GROUP BY alias HAVING count(DISTINCT store_id)=1
      )
      SELECT store_id,array_agg(alias ORDER BY alias) aliases
      FROM unique_aliases GROUP BY store_id
    `;
    const aliasesByStore=new Map(storeAliasRows.map(row=>[String(row.store_id),row.aliases||[]]));
    const storeAliases=storeId?(aliasesByStore.get(String(storeId))||[]):[];
    const forumFilters = storeAliases.length
      ? { network:'OWN_STORES', store:storeAliases.map(row=>row.alias) }
      : { network:'OWN_STORES' };
    currentStep='Azure PostgreSQL Forum quotation aggregates';
    const [forum, storeForum] = await Promise.all([
      sql`
        WITH matched_stores AS (
          SELECT DISTINCT upper(trim(a.valor_raw)) alias
          FROM sucursal_aliases a
          JOIN sucursales_master s ON s.sucursal_id=a.sucursal_id
          WHERE a.validated=true AND s.tipo_canal='CIDEF'
            AND lower(trim(s.nombre_canonico)) <> 'casa matriz'
            AND (${storeId}::text IS NULL OR s.sucursal_id::text=${storeId}::text)
        )
        SELECT to_char(u.fecha_cotizacion,'YYYY-MM') period_month,
               count(distinct u.numero_operacion)::int cotizaciones,
               count(distinct u.numero_operacion) FILTER (WHERE u.estado_actual='APROBADA')::int aprobados
        FROM forum_funnel_universe_v01 u
        JOIN matched_stores s ON upper(trim(u.sucursal))=s.alias
        WHERE upper(trim(u.distribuidor))='CIDEF'
          AND u.fecha_cotizacion::date >= ${periods[0].date_from}::date
          AND u.fecha_cotizacion::date <= ${cutoff}::date
          AND extract(day from u.fecha_cotizacion::date) <= ${Number(cutoff.slice(8,10))}
        GROUP BY 1
      `,
      !storeId ? sql`
        WITH matched_stores AS (
          SELECT upper(trim(a.valor_raw)) alias,min(s.sucursal_id)::text store_id
          FROM sucursal_aliases a JOIN sucursales_master s ON s.sucursal_id=a.sucursal_id
          WHERE a.validated=true AND s.tipo_canal='CIDEF' AND s.vigente=true
            AND lower(trim(s.nombre_canonico))<>'casa matriz'
          GROUP BY 1 HAVING count(distinct s.sucursal_id)=1
        )
        SELECT ms.store_id,
          count(distinct u.numero_operacion) FILTER (
            WHERE u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date
          )::int cotizaciones,
          count(distinct u.numero_operacion) FILTER (
            WHERE u.estado_actual='APROBADA'
              AND u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date
          )::int aprobados
        FROM forum_funnel_universe_v01 u JOIN matched_stores ms ON upper(trim(u.sucursal))=ms.alias
        WHERE upper(trim(u.distribuidor))='CIDEF'
          AND (u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date
            OR u.fecha_curse::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date)
        GROUP BY ms.store_id
      ` : []
    ]);
    const runId=`proyecciones-finanzas-${cutoff}-${Date.now()}`;
    currentStep='Azure PostgreSQL seller aliases';
    const sellerAliasRows=storeId?await sql`
      WITH active AS (
        SELECT persona_id FROM weekly_projection_sellers
        WHERE sucursal_id=${storeId}::bigint AND habilitado=true AND estado='ACTIVO' AND persona_id IS NOT NULL
      ), unique_aliases AS (
        SELECT upper(trim(a.valor_raw)) alias,min(a.persona_id)::text persona_id
        FROM persona_aliases a JOIN active w ON w.persona_id=a.persona_id
        WHERE a.validated=true AND a.fuente ILIKE '%forum%'
          AND nullif(trim(a.valor_raw),'') IS NOT NULL
        GROUP BY upper(trim(a.valor_raw)) HAVING count(DISTINCT a.persona_id)=1
      )
      SELECT persona_id,array_agg(alias ORDER BY alias) aliases
      FROM unique_aliases GROUP BY persona_id
    `:[];
    const p1 = await withP1Mcp(async client => {
      // SALES P1's bundled STORE_FINANCIAL_ENTITY observation returns the same certified
      // VIN-by-financier split without triggering separate temporal-fingerprint queries.
      const financeEvidence = [];
      for (const period of periods) {
        currentStep='SALES P1 STORE_FINANCIAL_ENTITY '+period.month;
        financeEvidence.push(await callP1(client,'sales_observe_many',{
          run_id:`${runId}-${period.label}`,period:period.month,cutoff:period.cutoff_date,
          commercial_universe:'OWN_STORES',
          operations:[...(period.label==='CURRENT'&&!storeId?[{kind:'STORE'}]:[]),{kind:'STORE_FINANCIAL_ENTITY'}]
        }));
      }
      const storeEvidence = storeId ? null : financeEvidence[financeEvidence.length-1];
      const observePrecurse=(runSuffix,filters,dimension)=>callP1(client,'data_observe',{
        run_id:`${runId}-precurse-${runSuffix}`,source:'FORUM',measure:'PRECURSE',
        evidence_shape:dimension?'DIMENSIONAL_QUANTITATIVE_DATASET':'QUANTITATIVE_OBSERVATION',
        ...(dimension?{dimension}:{}),filters
      });
      // P1 dimensional PRECURSE is the certified source for the same latest snapshot.
      // One STORE/SELLER observation replaces one database observation per store/seller.
      currentStep=storeId?'FORUM P1 PRECURSE store snapshot':'FORUM P1 PRECURSE by STORE';
      const precurse = !storeId
        ? await observePrecurse('stores',forumFilters,'STORE')
        : storeAliases.length ? await observePrecurse('store',forumFilters) : null;
      const storePrecurse = !storeId ? new Map((precurse?.payload?.members||[])
        .map(row=>[String(row.member_id),Number(row.value||0)])) : new Map();
      currentStep='FORUM P1 PRECURSE by SELLER';
      const sellerPrecurse = storeId && storeAliases.length && sellerAliasRows.length
        ? await observePrecurse('sellers',forumFilters,'SELLER') : null;
      const sellerPrecurseById = new Map((sellerPrecurse?.payload?.members||[])
        .map(row=>[String(row.member_id),Number(row.value||0)]));
      const precurseByStore = !storeId ? [...aliasesByStore.keys()].map(id=>({
        sucursal_id:id,value:storePrecurse.get(id)||0
      })) : [];
      const precurseBySeller = storeId && storeAliases.length
        ? sellerAliasRows.map(row=>({persona_id:String(row.persona_id),value:sellerPrecurseById.get(String(row.persona_id))||0}))
        : [];
      return {financeEvidence,storeEvidence,precurse,precurseByStore,precurseBySeller};
    });
    for (let index=0; index<periods.length; index++) {
      const evidence=p1.financeEvidence[index];
      const grouped=evidence?.results?.find(row=>row.operation?.kind==='STORE_FINANCIAL_ENTITY')?.evidence;
      const data=grouped||evidence;
      if (!Array.isArray(data?.payload?.members)) {
        throw new Error('SALES P1 STORE_FINANCIAL_ENTITY '+periods[index].month+' returned incomplete evidence');
      }
    }
    if (!storeId) {
      const storeResult=p1.storeEvidence?.results?.find(row=>row.operation?.kind==='STORE')?.evidence;
      if (!Array.isArray(storeResult?.payload?.members)) {
        throw new Error('SALES P1 STORE returned incomplete store evidence');
      }
    }
    if (!storeId || storeAliases.length) {
      const hasPrecurseMembers=Array.isArray(p1.precurse?.payload?.members);
      const hasPrecurseValue=p1.precurse?.payload?.value!=null && Number.isFinite(Number(p1.precurse.payload.value));
      if (!hasPrecurseMembers && !hasPrecurseValue) {
        throw new Error('FORUM P1 PRECURSE returned incomplete evidence');
      }
    }
    const forumMap=new Map(forum.map(row=>[row.period_month,row]));
    const financialPeriods=periods.map((period,index)=>{
      const counts=financeCounts(p1.financeEvidence[index],storeId);
      const funnel=forumMap.get(period.month)||{};
      return {...period,cotizaciones:Number(funnel.cotizaciones||0),aprobados:Number(funnel.aprobados||0),
        ufi:counts.ufi,otros:counts.otros,financing_unresolved:counts.unresolved};
    });
    const storeMap=new Map();
    for(const row of storeForum)storeMap.set(String(row.store_id),{
      sucursal_id:String(row.store_id),cotizaciones:Number(row.cotizaciones||0),aprobados:Number(row.aprobados||0),ventas:0,ufi:0,otros:0
    });
    if(p1.storeEvidence){
      const resultMap=new Map((p1.storeEvidence.results||[]).map(result=>[result.operation.kind,result.evidence]));
      const storeSales=resultMap.get('STORE')?.payload?.members||[];
      for(const member of storeSales){
        const id=String(member.member_id);
        const row=storeMap.get(id)||{sucursal_id:id,cotizaciones:0,aprobados:0,ventas:0,ufi:0,otros:0};
        row.ventas=Number(member.value||0);storeMap.set(id,row);
      }
      const financial=resultMap.get('STORE_FINANCIAL_ENTITY')?.payload?.members||[];
      for(const member of financial){
        const id=String(memberId(member,'STORE'));
        if(!id||id==='UNRESOLVED')continue;
        const row=storeMap.get(id)||{sucursal_id:id,cotizaciones:0,aprobados:0,ventas:0,ufi:0,otros:0};
        const counts=financeCounts({payload:{members:[{member_id:memberId(member,'FINANCIAL_ENTITY'),value:member.value}]}});
        row.ufi+=counts.ufi;row.otros+=counts.otros;storeMap.set(id,row);
      }
    }
    for(const item of p1.precurseByStore){
      const row=storeMap.get(item.sucursal_id)||{sucursal_id:item.sucursal_id,cotizaciones:0,aprobados:0,ventas:0,ufi:0,otros:0};
      row.precurse=item.value;storeMap.set(item.sucursal_id,row);
    }
    const rawPrecurseValue=p1.precurse?.payload?.value??p1.precurse?.coverage?.total_value??null;
    const precurseValue=rawPrecurseValue==null?null:Number(rawPrecurseValue);
    return NextResponse.json({ok:true,cutoff_date:cutoff,sucursal_id:storeId,
      precurse:{available:Boolean(p1.precurse),value:p1.precurse?precurseValue:null,snapshot_date:p1.precurse?.temporal?.snapshot_date||null,
        scope:storeId?'STORE':'OWN_STORES',by_store:p1.precurseByStore,by_seller:p1.precurseBySeller,
        store_alias_coverage:storeId?storeAliases.length>0:true},
      stores:[...storeMap.values()].map(row=>({...row,precurse:p1.precurseByStore.find(item=>item.sucursal_id===row.sucursal_id)?.value??null})),
      periods:financialPeriods});
  } catch (error) {
    console.error(error);
    return NextResponse.json({ok:false,error:currentStep+': '+(error?.message||'Internal server error')},{status:500});
  }
}

export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams, cutoff=params.get('cutoff_date'), storeId=params.get('sucursal_id')||null;
    const parsedCutoff = new Date(`${cutoff || ''}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff||'') || Number.isNaN(parsedCutoff.getTime()) || parsedCutoff.toISOString().slice(0,10) !== cutoff || (storeId && !/^\d+$/.test(storeId))) return calculate(request);
    const result = await withDailyReportSnapshot({
      reportKey: 'company-finance', periodStart: `${cutoff.slice(0,7)}-01`, cutoffDate: cutoff,
      dimension: storeId ? 'store' : 'company', dimensionId: storeId || 'company',
      force: new URL(request.url).searchParams.get('refresh') === '1',
      validate: (payload) => {
        const labels=['M-3','M-2','M-1','CURRENT'];
        if (payload?.ok !== true || !Array.isArray(payload.periods) || payload.periods.length !== 4) return false;
        if (!labels.every((label,index)=>payload.periods[index]?.label === label)) return false;
        if (!payload.periods.every(period=>['cotizaciones','aprobados','ufi','otros'].every(field=>typeof period[field] === 'number' && Number.isFinite(period[field])))) return false;
        if (!Array.isArray(payload.stores)) return false;
        if (payload.sucursal_id == null && (payload.precurse?.available !== true || typeof payload.precurse?.value !== 'number' || !Number.isFinite(payload.precurse.value))) return false;
        return true;
      },
      calculate: async () => {
        const response = await calculate(request);
        return { status: response.status, payload: await response.json() };
      },
    });
    if (result.status && result.status >= 400) return NextResponse.json(result.payload, { status: result.status });
    return NextResponse.json({ ...result.payload, snapshot: { updated_at: result.updatedAt, cache_hit: result.cacheHit, calculation_ms: result.calculationMs ?? 0 } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok:false, error:error?.message||'Internal server error' }, { status:500 });
  }
}
