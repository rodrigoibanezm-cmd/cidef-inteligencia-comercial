import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
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
const sumUnits=rows=>rows.reduce((n,r)=>n+Number(r.quantity??1),0);
function normalizeDate(v){return v ? String(v).slice(0,10) : null}
function periodSnapshot(all, cutoff, label, storeId, includeDetails=false, certifiedSales) {
  const from=monthStart(cutoff), weekFrom=minusDays(cutoff,6);
  const rows=all.filter(r=>(!storeId||String(r.sucursal_id)===String(storeId)) && r.fecha_venta>=from && r.fecha_venta<=cutoff);
  
  const certified=certifiedSales.get(`${from}|${cutoff}`);
  const certifiedWeek=certifiedSales.get(`${weekFrom>from?weekFrom:from}|${cutoff}`);
  const value=(entry)=>storeId?Number(entry?.members?.find(m=>String(m.member_id)===String(storeId))?.value??0):Number(entry?.total??0);
  if(includeDetails&&rows.some(r=>!r.sucursal_id||!r.persona_id))throw new Error('YOY_SALES_IDENTITY_UNRESOLVED');
  return { label, month:cutoff.slice(0,7), date_from:from, week_from:weekFrom, cutoff_date:cutoff, effective_cutoff_date:cutoff, mtd_units:value(certified), last_7d_units:value(certifiedWeek),
    ...(includeDetails?{details:rows.map(({vin,fecha_venta,sucursal_id,sucursal,persona_id,vendedor,vendedor_nombre})=>({vin,fecha_venta,sucursal_id,sucursal,persona_id,vendedor,vendedor_nombre}))}:{}) };
}
function byStore(rows, field='units') {
  const m=new Map(); for(const r of rows){const k=String(r.sucursal_id??`name:${r.sucursal}`),c=m.get(k)||{sucursal_id:r.sucursal_id,sucursal:r.sucursal,units:0};c.units+=Number(r[field]??r.quantity??1);m.set(k,c)} return m;
}

function brandTotals(rows) {
  const totals={foton:0,dongfeng:0,other:0};
  for(const row of rows){
    const brand=String(row.marca||'').trim().toUpperCase();
    const key=brand==='FOTON'?'foton':(brand==='DONGFENG'||brand==='DFM'?'dongfeng':'other');
    totals[key]+=Number(row.quantity??1);
  }
  return totals;
}
function monthBrandTotals(all,from,to,storeId){
  return brandTotals(all.filter(row=>(!storeId||String(row.sucursal_id)===String(storeId))&&row.fecha_venta>=from&&row.fecha_venta<=to));
}

export async function GET(request) {
  try {
    const url=new URL(request.url), weekStart=parseMonday(url.searchParams.get('week_start')), requestedCutoff=url.searchParams.get('cutoff_date')||weekStart, storeId=url.searchParams.get('sucursal_id')||null, sql=db();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedCutoff)) throw new Error('cutoff_date must use YYYY-MM-DD');
    const cutoffDate=requestedCutoff>=weekStart?requestedCutoff:weekStart;
    const historyFrom=shiftYear(monthStart(cutoffDate),-1);
    // P1 owns sales recognition, commercial scope and signed finance movements.
    const evidence=await withP1Mcp(client=>callP1(client,'data_fetch',{
      run_id:'weekly-projections-'+weekStart+'-'+cutoffDate,
      source:'SALES',
      filters:{commercial_universe:'OWN_STORES',date_from:historyFrom,date_to:cutoffDate},
      fields:['vin','sale_date','store_id','seller_id','brand_id','model_id','financial_entity','invoice','quantity']
    }));
    const [storesMeta,peopleMeta,brandsMeta,modelsMeta]=await Promise.all([
      sql`SELECT sucursal_id::text id,nombre_canonico name FROM sucursales_master`,
      sql`SELECT persona_id::text id,nombre_canonico name,usuario_canonico username FROM personas_master`,
      sql`SELECT marca_id::text id,nombre_canonico name FROM marcas_master_v01`,
      sql`SELECT modelo_id::text id,nombre_canonico name FROM modelos_master_v01`
    ]);
    const lookup=rows=>new Map(rows.map(r=>[String(r.id),r]));
    const storesById=lookup(storesMeta),peopleById=lookup(peopleMeta),
      brandsById=lookup(brandsMeta),modelsById=lookup(modelsMeta);
    const all=evidence.rows.map(r=>{
      const store=storesById.get(String(r.store_id)),person=peopleById.get(String(r.seller_id));
      const quantity=Number(r.quantity);
      return {vin:r.vin,fecha_venta:normalizeDate(r.sale_date),sucursal_id:r.store_id==null?null:String(r.store_id),
        sucursal:store?.name||null,persona_id:r.seller_id==null?null:String(r.seller_id),
        vendedor:person?.username||null,vendedor_nombre:person?.name||null,
        entidad_financiera:r.financial_entity,marca:brandsById.get(String(r.brand_id))?.name||'Sin marca',
        modelo:modelsById.get(String(r.model_id))?.name||'Sin modelo',factura:r.invoice,quantity};
    });
    const certifiedSales=new Map();
    const previousCutDate=normalizeDate((await sql`SELECT max(week_start)::text week_start FROM weekly_sales_projection WHERE week_start < ${weekStart}::date AND to_char(week_start,'YYYY-MM')=${weekStart.slice(0,7)}`)[0]?.week_start);
    const nextCutDate=plusDays(weekStart,7);
    const relevantDates=[cutoffDate,shiftYear(cutoffDate,-1),shiftMonth(cutoffDate,-3),shiftMonth(cutoffDate,-2),shiftMonth(cutoffDate,-1),
      shiftYear(monthStart(cutoffDate),-1),nextCutDate,...[-3,-2,-1].map(n=>shiftMonth(nextCutDate,n)),...(previousCutDate?[previousCutDate]:[])];
    const lastYearEnd=ymd(new Date(Date.UTC(Number(cutoffDate.slice(0,4))-1,Number(cutoffDate.slice(5,7)),0)));
    relevantDates.push(lastYearEnd);
    const ranges=new Map();
    for(const date of relevantDates){
      const from=monthStart(date),weekFrom=minusDays(date,6);
      ranges.set(`${from}|${date}`,[from,date]);
      ranges.set(`${weekFrom>from?weekFrom:from}|${date}`,[weekFrom>from?weekFrom:from,date]);
    }
    await withP1Mcp(async client=>{
      for(const [key,[from,to]] of ranges){
        const args={run_id:'weekly-projections-'+weekStart+'-'+to,source:'SALES',measure:'VIN_SALES',
          filters:{commercial_universe:'OWN_STORES',date_from:from,date_to:to}};
        const [total,stores]=await Promise.all([
          callP1(client,'data_observe',args),
          callP1(client,'data_observe',{...args,evidence_shape:'DIMENSIONAL_QUANTITATIVE_DATASET',dimension:'STORE'})
        ]);
        certifiedSales.set(key,{total:total.payload.value,members:stores.payload.members});
      }
    });
    const cuts=[['M-3',shiftMonth(cutoffDate,-3)],['M-2',shiftMonth(cutoffDate,-2)],['M-1',shiftMonth(cutoffDate,-1)],['CURRENT',cutoffDate],['YOY',shiftYear(cutoffDate,-1)]];
    const periods=cuts.map(([label,date])=>periodSnapshot(all,date,label,storeId,label==='YOY',certifiedSales));
    const current=periods.find(p=>p.label==='CURRENT'), yoyP=periods.find(p=>p.label==='YOY'), prior=periods.filter(p=>['M-3','M-2','M-1'].includes(p.label));
    const lastYearMonth=shiftYear(cutoffDate,-1);
    const lastYearMonthEnd=ymd(new Date(Date.UTC(Number(lastYearMonth.slice(0,4)),Number(lastYearMonth.slice(5,7)),0)));
    const lastYearFullMonth=periodSnapshot(all,lastYearMonthEnd,'YOY_FULL',storeId,false,certifiedSales).mtd_units;
    const lastYearBrand=monthBrandTotals(all,monthStart(lastYearMonth),lastYearMonthEnd,storeId);
    const avgMtd=prior.reduce((s,p)=>s+p.mtd_units,0)/3, avgWeek=prior.reduce((s,p)=>s+p.last_7d_units,0)/3;
    const currentDetails=all.filter(r=>(!storeId||String(r.sucursal_id)===String(storeId))&&r.fecha_venta>=current.date_from&&r.fecha_venta<=cutoffDate);
    const currentRows=(certifiedSales.get(`${current.date_from}|${cutoffDate}`)?.members||[]).map(m=>({sucursal_id:m.member_id,sucursal:m.member_label,units:m.value}));
    const previousCut=previousCutDate;
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
    const prevPeriod=previousCut?periodSnapshot(all,previousCut,'PREVIOUS',storeId,false,certifiedSales):null;
    const previousProjection=previousProjectionRows.reduce((s,r)=>s+Number(r.projected_units||0),0);
    const stores=[];
    if(previousCut&&!storeId){const pm=byStore(previousProjectionRows,'projected_units'), prevSales=new Map((certifiedSales.get(`${monthStart(previousCut)}|${previousCut}`)?.members||[]).map(m=>[String(m.member_id),{sucursal_id:m.member_id,sucursal:m.member_label,units:m.value}])), curSales=new Map(currentRows.map(r=>[String(r.sucursal_id),r]));const keys=new Set([...pm.keys(),...prevSales.keys(),...curSales.keys()]);for(const k of keys){const p=pm.get(k),a=prevSales.get(k),c=curSales.get(k),prev=Number(a?.units||0),proj=Number(p?.units||0),cur=Number(c?.units||0);stores.push({sucursal_id:p?.sucursal_id||a?.sucursal_id||c?.sucursal_id,sucursal:p?.sucursal||a?.sucursal||c?.sucursal,previous_sales_mtd:prev,previous_projection:proj,expected_current:prev+proj,current_sales_mtd:cur,new_sales:cur-prev,projection_fulfillment:ratio(cur-prev,proj),expected_fulfillment:ratio(cur,prev+proj)})}}
    const summary={total_units:projections.reduce((s,r)=>s+Number(r.projected_units||0),0),sent_not_invoiced_units:sentNotInvoiced.reduce((s,r)=>s+Number(r.units||0),0)};
    const nextCut=plusDays(weekStart,7), expectedNext=current.mtd_units+summary.total_units;
    const nextPrior=[-3,-2,-1].map((delta,i)=>periodSnapshot(all,shiftMonth(nextCut,delta),`M-${3-i}`,storeId,false,certifiedSales));
    const nextAvg=nextPrior.reduce((s,p)=>s+p.mtd_units,0)/nextPrior.length;
    const nextCutContext={cutoff_date:nextCut,expected_units:expectedNext,prior_periods:nextPrior,prior_average:nextAvg,change_vs_prior_average:ratio(expectedNext-nextAvg,nextAvg)};
    const response={ok:true,week_start:weekStart,sucursal_id:storeId,summary,sent_not_invoiced:sentNotInvoiced,sales_mtd:{month:cutoffDate.slice(0,7),date_from:current.date_from,date_to:cutoffDate,cutoff_date:cutoffDate,total_units:current.mtd_units,rows:currentRows,details:currentDetails},historical_context:{periods,yoy:{mtd_change:ratio(current.mtd_units-yoyP.mtd_units,yoyP.mtd_units),last_7d_change:ratio(current.last_7d_units-yoyP.last_7d_units,yoyP.last_7d_units),current_mtd:current.mtd_units,yoy_mtd:yoyP.mtd_units,yoy_full_month:lastYearFullMonth,yoy_full_month_by_brand:lastYearBrand,current_last_7d:current.last_7d_units,yoy_last_7d:yoyP.last_7d_units},recent_3m:{mtd_average:avgMtd,last_7d_average:avgWeek,mtd_change:ratio(current.mtd_units-avgMtd,avgMtd),last_7d_change:ratio(current.last_7d_units-avgWeek,avgWeek)}},next_cut_context:nextCutContext,evolution:previousCut?{previous_cut:previousCut,current_cut:weekStart,previous_sales_mtd:prevPeriod.mtd_units,previous_projection:previousProjection,expected_current:prevPeriod.mtd_units+previousProjection,current_sales_mtd:current.mtd_units,new_sales:current.mtd_units-prevPeriod.mtd_units,projection_fulfillment:ratio(current.mtd_units-prevPeriod.mtd_units,previousProjection),expected_fulfillment:ratio(current.mtd_units,prevPeriod.mtd_units+previousProjection),stores}:null,projections};
    if(url.searchParams.get('include_scopes')==='1'){
      const ids=(url.searchParams.get('scope_ids')||'').split(',').filter(id=>/^\d+$/.test(id));
      response.scopes={};
      for(const id of ids){
        const scopedPeriods=cuts.map(([label,date])=>periodSnapshot(all,date,label,id,label==='YOY',certifiedSales));
        const scopedCurrent=scopedPeriods.find(p=>p.label==='CURRENT'), scopedYoy=scopedPeriods.find(p=>p.label==='YOY');
        const scopedPrior=scopedPeriods.filter(p=>['M-3','M-2','M-1'].includes(p.label));
        const scopedAvgMtd=scopedPrior.reduce((sum,p)=>sum+p.mtd_units,0)/3, scopedAvgWeek=scopedPrior.reduce((sum,p)=>sum+p.last_7d_units,0)/3;
        const details=all.filter(r=>String(r.sucursal_id)===id&&r.fecha_venta>=scopedCurrent.date_from&&r.fecha_venta<=cutoffDate);
        const previousDetails=previousCut?all.filter(r=>String(r.sucursal_id)===id&&r.fecha_venta>=monthStart(previousCut)&&r.fecha_venta<=previousCut):[];
        const scopedProjection=previousProjectionRows.filter(r=>String(r.sucursal_id)===id).reduce((sum,r)=>sum+Number(r.projected_units||0),0);
        const currentProjection=projections.filter(r=>String(r.sucursal_id)===id).reduce((sum,r)=>sum+Number(r.projected_units||0),0);
        const nextDate=plusDays(weekStart,7), nextPeriods=[-3,-2,-1].map((delta,i)=>periodSnapshot(all,shiftMonth(nextDate,delta),`M-${3-i}`,id,false,certifiedSales));
        const nextAverage=nextPeriods.reduce((sum,p)=>sum+p.mtd_units,0)/nextPeriods.length, nextExpected=scopedCurrent.mtd_units+currentProjection;
        response.scopes[id]={ok:true,week_start:weekStart,sucursal_id:id,summary:{total_units:0,sent_not_invoiced_units:0},sales_mtd:{month:cutoffDate.slice(0,7),date_from:scopedCurrent.date_from,date_to:cutoffDate,cutoff_date:cutoffDate,total_units:scopedCurrent.mtd_units,rows:currentRows.filter(r=>String(r.sucursal_id)===id),details},historical_context:{periods:scopedPeriods,yoy:{mtd_change:ratio(scopedCurrent.mtd_units-scopedYoy.mtd_units,scopedYoy.mtd_units),last_7d_change:ratio(scopedCurrent.last_7d_units-scopedYoy.last_7d_units,scopedYoy.last_7d_units),current_mtd:scopedCurrent.mtd_units,yoy_mtd:scopedYoy.mtd_units,yoy_full_month:periodSnapshot(all,lastYearMonthEnd,'YOY_FULL',id,false,certifiedSales).mtd_units,yoy_full_month_by_brand:monthBrandTotals(all,monthStart(lastYearMonth),lastYearMonthEnd,id),current_last_7d:scopedCurrent.last_7d_units,yoy_last_7d:scopedYoy.last_7d_units},recent_3m:{mtd_average:scopedAvgMtd,last_7d_average:scopedAvgWeek,mtd_change:ratio(scopedCurrent.mtd_units-scopedAvgMtd,scopedAvgMtd),last_7d_change:ratio(scopedCurrent.last_7d_units-scopedAvgWeek,scopedAvgWeek)}},next_cut_context:{cutoff_date:nextDate,expected_units:nextExpected,prior_periods:nextPeriods,prior_average:nextAverage,change_vs_prior_average:ratio(nextExpected-nextAverage,nextAverage)},evolution:previousCut?{previous_cut:previousCut,current_cut:weekStart,previous_sales_mtd:periodSnapshot(all,previousCut,'PREVIOUS',id,false,certifiedSales).mtd_units,previous_projection:scopedProjection,expected_current:periodSnapshot(all,previousCut,'PREVIOUS',id,false,certifiedSales).mtd_units+scopedProjection,current_sales_mtd:scopedCurrent.mtd_units,new_sales:scopedCurrent.mtd_units-periodSnapshot(all,previousCut,'PREVIOUS',id,false,certifiedSales).mtd_units,projection_fulfillment:ratio(scopedCurrent.mtd_units-periodSnapshot(all,previousCut,'PREVIOUS',id,false,certifiedSales).mtd_units,scopedProjection),expected_fulfillment:ratio(scopedCurrent.mtd_units,periodSnapshot(all,previousCut,'PREVIOUS',id,false,certifiedSales).mtd_units+scopedProjection),stores:[]}:null,projections:[]};
      }
    }
    return NextResponse.json(response);
  } catch(error){console.error(error);return NextResponse.json({ok:false,error:error?.message||'Internal server error'},{status:400});}
}
