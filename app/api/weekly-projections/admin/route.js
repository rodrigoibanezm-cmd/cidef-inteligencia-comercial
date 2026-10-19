import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { withDailyReportSnapshot } from '../../../../lib/daily-report-snapshot.js';
import { withP1Mcp, callP1 } from '../../../../lib/p1-client.js';

export const dynamic = 'force-dynamic';

const ymd = (d) => d.toISOString().slice(0, 10);
function parseMonday(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('week_start must use YYYY-MM-DD');
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDay() !== 1) throw new Error('week_start must be a Monday');
  return value;
}
function shiftMonth(date, delta) {
  const d = new Date(`${date}T12:00:00Z`), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + delta);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last)); return ymd(d);
}
function shiftYear(date, delta) { const d=new Date(`${date}T12:00:00Z`); d.setUTCFullYear(d.getUTCFullYear()+delta); return ymd(d); }
function minusDays(date,n){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-n);return ymd(d)}
function plusDays(date,n){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return ymd(d)}
function monthStart(date){return `${date.slice(0,7)}-01`}
const ratio=(n,d)=>d? n/d:null;
function normalizeDate(v){return v ? String(v).slice(0,10) : null}
function financeCounts(evidence) {
  const counts={ufi:0,otros:0,unresolved:0};
  for(const member of evidence?.payload?.members||[]){
    const entity=String(member.member_id??'').trim().toUpperCase(),value=Number(member.value||0);
    if(entity==='UNRESOLVED'||!entity)counts.unresolved+=value;
    else if(entity==='FORUM')counts.ufi+=value;
    else counts.otros+=value;
  }
  return counts;
}
function periodSnapshot(all, cutoff, label, storeId) {
  const from=monthStart(cutoff), weekFrom=minusDays(cutoff,6);
  const rows=all.filter(r=>(!storeId||String(r.sucursal_id)===String(storeId)) && r.fecha_venta>=from && r.fecha_venta<=cutoff);
  const week=rows.filter(r=>r.fecha_venta>=weekFrom);
  return { label, month:cutoff.slice(0,7), date_from:from, week_from:weekFrom, cutoff_date:cutoff, effective_cutoff_date:cutoff, mtd_units:rows.length, last_7d_units:week.length };
}
function byStore(rows, field='units') {
  const m=new Map(); for(const r of rows){const k=String(r.sucursal_id??`name:${r.sucursal}`),c=m.get(k)||{sucursal_id:r.sucursal_id,sucursal:r.sucursal,units:0};c.units+=Number(r[field]??1);m.set(k,c)} return m;
}

async function calculate(request) {
  try {
    const url=new URL(request.url), weekStart=parseMonday(url.searchParams.get('week_start')), requestedCutoff=url.searchParams.get('cutoff_date')||weekStart, storeId=url.searchParams.get('sucursal_id')||null, sql=db();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedCutoff)) throw new Error('cutoff_date must use YYYY-MM-DD');
    const cutoffDate=requestedCutoff.slice(0,7)===weekStart.slice(0,7)&&requestedCutoff>=weekStart?requestedCutoff:weekStart;
    const historyFrom=shiftYear(monthStart(cutoffDate),-1);
    const p1RunId=`proyecciones-admin-${cutoffDate}-${Date.now()}`;
    const salesFilters={commercial_universe:'OWN_STORES',date_from:historyFrom,date_to:cutoffDate,...(storeId?{store_id:storeId}:{})};
    const salesEvidence=await withP1Mcp(async client=>callP1(client,'data_fetch',{
      run_id:p1RunId,source:'SALES',filters:salesFilters,
      fields:['vin','sale_date','invoice','brand_id','model_id','version_id','store_id','store_label','seller_id']
    }));
    let sellerLabels=new Map(),sellerFinance=[];
    if(storeId){
      const sellers=await withP1Mcp(async client=>callP1(client,'data_observe',{
        run_id:p1RunId+'-sellers',source:'SALES',measure:'VIN_SALES',
        evidence_shape:'DIMENSIONAL_QUANTITATIVE_DATASET',dimension:'SELLER',
        filters:{...salesFilters,date_from:monthStart(cutoffDate),date_to:cutoffDate}
      }));
      const sellerMembers=sellers.payload?.members||[];
      sellerLabels=new Map(sellerMembers.map(row=>[String(row.member_id),row.member_label]));
      sellerFinance=await withP1Mcp(async client=>Promise.all(sellerMembers
        .filter(row=>row.member_id!=null&&String(row.member_id)!=='UNRESOLVED')
        .map(async row=>{
          const sellerId=String(row.member_id);
          const evidence=await callP1(client,'data_observe',{
            run_id:`${p1RunId}-finance-${sellerId}`,source:'SALES',measure:'VIN_SALES',
            evidence_shape:'DIMENSIONAL_QUANTITATIVE_DATASET',dimension:'FINANCIAL_ENTITY',
            filters:{...salesFilters,date_from:monthStart(cutoffDate),date_to:cutoffDate,seller_id:sellerId}
          });
          return {persona_id:sellerId,...financeCounts(evidence)};
        })));
    }
    const all=(salesEvidence.rows||[]).map(r=>{
      const sellerId=r.seller_id==null?null:String(r.seller_id);
      const sellerName=sellerId?sellerLabels.get(sellerId):null;
      return {
        vin:r.vin,fecha_venta:normalizeDate(r.sale_date),sucursal_id:r.store_id==null?null:String(r.store_id),
        sucursal:r.store_label||'Tienda no resuelta',vendedor:sellerName||sellerId||'Usuario ERP sin nombre',
        persona_id:sellerId,vendedor_nombre:sellerName||'Usuario ERP sin nombre',
        marca:r.brand_id||'Sin marca',modelo:r.model_id||'Sin modelo',
        factura:r.invoice
      };
    }).filter(r=>r.fecha_venta);
    const cuts=[['M-3',shiftMonth(cutoffDate,-3)],['M-2',shiftMonth(cutoffDate,-2)],['M-1',shiftMonth(cutoffDate,-1)],['CURRENT',cutoffDate],['YOY',shiftYear(cutoffDate,-1)]];
    const periods=cuts.map(([label,date])=>periodSnapshot(all,date,label,storeId));
    const current=periods.find(p=>p.label==='CURRENT'), yoyP=periods.find(p=>p.label==='YOY'), prior=periods.filter(p=>['M-3','M-2','M-1'].includes(p.label));
    const avgMtd=prior.reduce((s,p)=>s+p.mtd_units,0)/3, avgWeek=prior.reduce((s,p)=>s+p.last_7d_units,0)/3;
    const currentDetails=all.filter(r=>(!storeId||String(r.sucursal_id)===String(storeId))&&r.fecha_venta>=current.date_from&&r.fecha_venta<=cutoffDate);
    const currentRows=[...byStore(currentDetails).values()];
    const previousCutRows=await sql`SELECT max(week_start)::text week_start FROM weekly_sales_projection WHERE week_start < ${weekStart}::date AND to_char(week_start,'YYYY-MM')=${weekStart.slice(0,7)}`;
    const previousCut=normalizeDate(previousCutRows[0]?.week_start);
    const projections=await sql`
      SELECT p.projection_id::text, p.week_start::text, p.sucursal_id::text, s.nombre_canonico sucursal,
        p.persona_id::text, pe.nombre_canonico vendedor, p.modelo_id::text,
        coalesce(ma.nombre_canonico,p.source_brand_raw,'Sin marca') marca,
        coalesce(m.nombre_canonico,p.source_model_raw,'Sin modelo') modelo,
        p.projected_units, p.expected_close_date::text, p.crm_opportunity_id
      FROM weekly_sales_projection p
      LEFT JOIN sucursales_master s ON s.sucursal_id=p.sucursal_id
      LEFT JOIN personas_master pe ON pe.persona_id=p.persona_id
      LEFT JOIN modelos_master_v01 m ON m.modelo_id=p.modelo_id
      LEFT JOIN marcas_master_v01 ma ON ma.marca_id=m.marca_id
      WHERE p.week_start=${weekStart}::date AND (${storeId}::text IS NULL OR p.sucursal_id::text=${storeId}::text)
      ORDER BY s.nombre_canonico,pe.nombre_canonico,p.projection_id
    `;
    const sentNotInvoiced=await sql`
      SELECT x.sent_not_invoiced_id::text, x.sucursal_id::text, s.nombre_canonico sucursal,
        x.persona_id::text, coalesce(pe.nombre_canonico,wps.nombre,'Sin vendedor') vendedor,
        x.units, coalesce(ma.nombre_canonico,'Sin marca') marca,
        coalesce(m.nombre_canonico,'Sin modelo') modelo
      FROM sales_sent_not_invoiced x
      LEFT JOIN sucursales_master s ON s.sucursal_id=x.sucursal_id
      LEFT JOIN personas_master pe ON pe.persona_id=x.persona_id
      LEFT JOIN weekly_projection_sellers wps ON wps.persona_id=x.persona_id AND wps.sucursal_id=x.sucursal_id
      LEFT JOIN modelos_master_v01 m ON m.modelo_id=x.modelo_id
      LEFT JOIN marcas_master_v01 ma ON ma.marca_id=m.marca_id
      WHERE x.status='PENDING'
        AND COALESCE(x.week_start, date_trunc('week', x.sent_at AT TIME ZONE 'America/Santiago')::date)=${weekStart}::date
        AND (${storeId}::text IS NULL OR x.sucursal_id::text=${storeId}::text)
      ORDER BY s.nombre_canonico,vendedor,x.sent_not_invoiced_id
    `;
    let previousProjectionRows=[];
    if(previousCut){ previousProjectionRows=await sql`
      SELECT p.sucursal_id::text, s.nombre_canonico sucursal, sum(p.projected_units)::int projected_units
      FROM weekly_sales_projection p LEFT JOIN sucursales_master s ON s.sucursal_id=p.sucursal_id
      WHERE p.week_start=${previousCut}::date AND (${storeId}::text IS NULL OR p.sucursal_id::text=${storeId}::text)
      GROUP BY p.sucursal_id,s.nombre_canonico` }
    const prevPeriod=previousCut?periodSnapshot(all,previousCut,'PREVIOUS',storeId):null;
    const previousProjection=previousProjectionRows.reduce((s,r)=>s+Number(r.projected_units||0),0);
    const stores=[];
    if(previousCut&&!storeId){const pm=byStore(previousProjectionRows,'projected_units'), prevSales=byStore(all.filter(r=>r.fecha_venta>=monthStart(previousCut)&&r.fecha_venta<=previousCut)), curSales=byStore(currentDetails);const keys=new Set([...pm.keys(),...prevSales.keys(),...curSales.keys()]);for(const k of keys){const p=pm.get(k),a=prevSales.get(k),c=curSales.get(k),prev=Number(a?.units||0),proj=Number(p?.units||0),cur=Number(c?.units||0);stores.push({sucursal_id:p?.sucursal_id||a?.sucursal_id||c?.sucursal_id,sucursal:p?.sucursal||a?.sucursal||c?.sucursal,previous_sales_mtd:prev,previous_projection:proj,expected_current:prev+proj,current_sales_mtd:cur,new_sales:cur-prev,projection_fulfillment:ratio(cur-prev,proj),expected_fulfillment:ratio(cur,prev+proj)})}}
    const summary={total_units:projections.reduce((s,r)=>s+Number(r.projected_units||0),0),sent_not_invoiced_units:sentNotInvoiced.reduce((s,r)=>s+Number(r.units||0),0)};
    const nextCut=plusDays(weekStart,7), expectedNext=current.mtd_units+summary.total_units;
    const nextPrior=[-3,-2,-1].map((delta,i)=>periodSnapshot(all,shiftMonth(nextCut,delta),`M-${3-i}`,storeId));
    const nextAvg=nextPrior.reduce((s,p)=>s+p.mtd_units,0)/nextPrior.length;
    const nextCutContext={cutoff_date:nextCut,expected_units:expectedNext,prior_periods:nextPrior,prior_average:nextAvg,change_vs_prior_average:ratio(expectedNext-nextAvg,nextAvg)};
    return NextResponse.json({ok:true,week_start:weekStart,sucursal_id:storeId,summary,sent_not_invoiced:sentNotInvoiced,sales_mtd:{month:cutoffDate.slice(0,7),date_from:current.date_from,date_to:cutoffDate,cutoff_date:cutoffDate,total_units:current.mtd_units,rows:currentRows,details:currentDetails,seller_finance:sellerFinance},historical_context:{periods,yoy:{mtd_change:ratio(current.mtd_units-yoyP.mtd_units,yoyP.mtd_units),last_7d_change:ratio(current.last_7d_units-yoyP.last_7d_units,yoyP.last_7d_units),current_mtd:current.mtd_units,yoy_mtd:yoyP.mtd_units,current_last_7d:current.last_7d_units,yoy_last_7d:yoyP.last_7d_units},recent_3m:{mtd_average:avgMtd,last_7d_average:avgWeek,mtd_change:ratio(current.mtd_units-avgMtd,avgMtd),last_7d_change:ratio(current.last_7d_units-avgWeek,avgWeek)}},next_cut_context:nextCutContext,evolution:previousCut?{previous_cut:previousCut,current_cut:weekStart,previous_sales_mtd:prevPeriod.mtd_units,previous_projection:previousProjection,expected_current:prevPeriod.mtd_units+previousProjection,current_sales_mtd:current.mtd_units,new_sales:current.mtd_units-prevPeriod.mtd_units,projection_fulfillment:ratio(current.mtd_units-prevPeriod.mtd_units,previousProjection),expected_fulfillment:ratio(current.mtd_units,prevPeriod.mtd_units+previousProjection),stores}:null,projections});
  } catch(error){console.error(error);return NextResponse.json({ok:false,error:error?.message||'Internal server error'},{status:400});}
}

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const rawWeek = params.get('week_start') || '';
    const rawCutoff = params.get('cutoff_date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawWeek) || (rawCutoff && !/^\d{4}-\d{2}-\d{2}$/.test(rawCutoff))) return calculate(request);
    const parsedWeek = new Date(`${rawWeek}T12:00:00Z`);
    const parsedCutoff = rawCutoff ? new Date(`${rawCutoff}T00:00:00Z`) : null;
    if (Number.isNaN(parsedWeek.getTime()) || parsedWeek.getUTCDay() !== 1 || (parsedCutoff && (Number.isNaN(parsedCutoff.getTime()) || parsedCutoff.toISOString().slice(0,10) !== rawCutoff))) return calculate(request);
    const weekStart = rawWeek, requestedCutoff = rawCutoff || weekStart, storeId = params.get('sucursal_id') || null;
    const cutoffDate = requestedCutoff.slice(0,7) === weekStart.slice(0,7) && requestedCutoff >= weekStart ? requestedCutoff : weekStart;
    const result = await withDailyReportSnapshot({
      reportKey: 'admin', periodStart: weekStart, cutoffDate: cutoffDate,
      dimension: storeId ? 'store' : 'company', dimensionId: storeId || 'company',
      force: new URL(request.url).searchParams.get('refresh') === '1',
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
