import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';

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
function periodSnapshot(all, cutoff, label, storeId) {
  const from=monthStart(cutoff), weekFrom=minusDays(cutoff,6);
  const rows=all.filter(r=>(!storeId||String(r.sucursal_id)===String(storeId)) && r.fecha_venta>=from && r.fecha_venta<=cutoff);
  const week=rows.filter(r=>r.fecha_venta>=weekFrom);
  return { label, month:cutoff.slice(0,7), date_from:from, week_from:weekFrom, cutoff_date:cutoff, effective_cutoff_date:cutoff, mtd_units:rows.length, last_7d_units:week.length };
}
function byStore(rows, field='units') {
  const m=new Map(); for(const r of rows){const k=String(r.sucursal_id??`name:${r.sucursal}`),c=m.get(k)||{sucursal_id:r.sucursal_id,sucursal:r.sucursal,units:0};c.units+=Number(r[field]??1);m.set(k,c)} return m;
}

export async function GET(request) {
  try {
    const url=new URL(request.url), weekStart=parseMonday(url.searchParams.get('week_start')), requestedCutoff=url.searchParams.get('cutoff_date')||weekStart, storeId=url.searchParams.get('sucursal_id')||null, sql=db();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedCutoff)) throw new Error('cutoff_date must use YYYY-MM-DD');
    const cutoffDate=requestedCutoff>=weekStart?requestedCutoff:weekStart;
    const historyFrom=shiftYear(monthStart(cutoffDate),-1);
    const salesRaw=await sql`
      SELECT DISTINCT ON (upper(trim(v.nro_vin_chasis)))
        upper(trim(v.nro_vin_chasis)) vin,
        (CASE WHEN trim(v.fecha_factura::text) ~ '^[0-9]+$' THEN DATE '1899-12-30' + trim(v.fecha_factura::text)::integer ELSE nullif(trim(v.fecha_factura::text),'')::date END)::text fecha_venta,
        sm.sucursal_id::text sucursal_id,
        sm.nombre_canonico sucursal,
        v.nombre_usuario vendedor,
        pe.persona_id::text persona_id,
        coalesce(pe.nombre_canonico, nullif(trim(v.nombre_usuario),''), 'Usuario ERP sin nombre') vendedor_nombre,
        v.entidad_financiera,
        coalesce(ma.nombre_canonico,v.desc_mae_marca,'Sin marca') marca,
        coalesce(mo.nombre_canonico,vc.modelo_raw,v.desc_articulo,'Sin modelo') modelo,
        coalesce(v.nro_factura,v.factura) factura
      FROM ventas_raw v
      LEFT JOIN LATERAL (

        SELECT candidate.sucursal_id

        FROM (

          SELECT sm_erp.sucursal_id, 0 AS priority

          FROM sucursales_master sm_erp

          WHERE sm_erp.id_sucursal_vta::text = nullif(trim(v.id_sucursal_vta::text), '')

          UNION ALL

          SELECT a.sucursal_id, 1 AS priority

          FROM sucursal_aliases a

          WHERE a.validated = true

            AND lower(trim(a.valor_raw)) = lower(trim(v.desc_sucursal_vta))

        ) candidate

        ORDER BY candidate.priority, candidate.sucursal_id

        LIMIT 1

      ) resolved_store ON true

      LEFT JOIN sucursales_master sm
        ON (resolved_store.sucursal_id = sm.sucursal_id)

        OR (resolved_store.sucursal_id IS NULL AND (
        lower(trim(sm.nombre_canonico)) = lower(trim(regexp_replace(v.desc_sucursal_vta, '^Sucursal\\s+', '', 'i')))
        OR lower(trim(sm.nombre_canonico)) = lower(trim('CIDEF ' || regexp_replace(v.desc_sucursal_vta, '^Sucursal\\s+', '', 'i')))
        OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza alameda' AND sm.sucursal_id=19)
        OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza sur' AND sm.sucursal_id=9)
        OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza egaña' AND sm.sucursal_id=11)
        OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza norte' AND sm.sucursal_id=8)
        OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza oeste' AND sm.sucursal_id=10)
        OR (lower(trim(v.desc_sucursal_vta))='sucursal quilin' AND sm.sucursal_id=21)
        OR (lower(trim(v.desc_sucursal_vta))='costanera' AND sm.sucursal_id=22)))
      LEFT JOIN personas_master pe ON upper(trim(pe.usuario_canonico))=upper(trim(v.nombre_usuario))
      LEFT JOIN vehiculo_canonico vc ON upper(trim(vc.vin))=upper(trim(v.nro_vin_chasis))
      LEFT JOIN versiones_master_v01 ve ON ve.version_id=vc.version_id
      LEFT JOIN modelos_master_v01 mo ON mo.modelo_id=ve.modelo_id
      LEFT JOIN marcas_master_v01 ma ON ma.marca_id=mo.marca_id
      WHERE btrim(v.categoria_cliente)='Cliente General'
        AND nullif(trim(v.nro_vin_chasis),'') IS NOT NULL
        AND (CASE WHEN trim(v.fecha_factura::text) ~ '^[0-9]+$' THEN DATE '1899-12-30' + trim(v.fecha_factura::text)::integer ELSE nullif(trim(v.fecha_factura::text),'')::date END) BETWEEN ${historyFrom}::date AND ${cutoffDate}::date
        AND lower(coalesce(trim(v.desc_sucursal_vta),'')) <> 'casa matriz'
      ORDER BY upper(trim(v.nro_vin_chasis)), (CASE WHEN trim(v.fecha_factura::text) ~ '^[0-9]+$' THEN DATE '1899-12-30' + trim(v.fecha_factura::text)::integer ELSE nullif(trim(v.fecha_factura::text),'')::date END) DESC
    `;
    const all=salesRaw.map(r=>({...r,fecha_venta:normalizeDate(r.fecha_venta)}));
    const cuts=[['M-3',shiftMonth(cutoffDate,-3)],['M-2',shiftMonth(cutoffDate,-2)],['M-1',shiftMonth(cutoffDate,-1)],['CURRENT',cutoffDate],['YOY',shiftYear(cutoffDate,-1)]];
    const periods=cuts.map(([label,date])=>periodSnapshot(all,date,label,storeId));
    const current=periods.find(p=>p.label==='CURRENT'), yoyP=periods.find(p=>p.label==='YOY'), prior=periods.filter(p=>['M-3','M-2','M-1'].includes(p.label));
    const lastYearMonth=shiftYear(cutoffDate,-1);
    const lastYearMonthEnd=ymd(new Date(Date.UTC(Number(lastYearMonth.slice(0,4)),Number(lastYearMonth.slice(5,7)),0)));
    const lastYearFullMonth=periodSnapshot(all,lastYearMonthEnd,'YOY_FULL',storeId).mtd_units;
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
    const response={ok:true,week_start:weekStart,sucursal_id:storeId,summary,sent_not_invoiced:sentNotInvoiced,sales_mtd:{month:cutoffDate.slice(0,7),date_from:current.date_from,date_to:cutoffDate,cutoff_date:cutoffDate,total_units:current.mtd_units,rows:currentRows,details:currentDetails},historical_context:{periods,yoy:{mtd_change:ratio(current.mtd_units-yoyP.mtd_units,yoyP.mtd_units),last_7d_change:ratio(current.last_7d_units-yoyP.last_7d_units,yoyP.last_7d_units),current_mtd:current.mtd_units,yoy_mtd:yoyP.mtd_units,yoy_full_month:lastYearFullMonth,current_last_7d:current.last_7d_units,yoy_last_7d:yoyP.last_7d_units},recent_3m:{mtd_average:avgMtd,last_7d_average:avgWeek,mtd_change:ratio(current.mtd_units-avgMtd,avgMtd),last_7d_change:ratio(current.last_7d_units-avgWeek,avgWeek)}},next_cut_context:nextCutContext,evolution:previousCut?{previous_cut:previousCut,current_cut:weekStart,previous_sales_mtd:prevPeriod.mtd_units,previous_projection:previousProjection,expected_current:prevPeriod.mtd_units+previousProjection,current_sales_mtd:current.mtd_units,new_sales:current.mtd_units-prevPeriod.mtd_units,projection_fulfillment:ratio(current.mtd_units-prevPeriod.mtd_units,previousProjection),expected_fulfillment:ratio(current.mtd_units,prevPeriod.mtd_units+previousProjection),stores}:null,projections};
    if(url.searchParams.get('include_scopes')==='1'){
      const ids=(url.searchParams.get('scope_ids')||'').split(',').filter(id=>/^\d+$/.test(id));
      response.scopes={};
      for(const id of ids){
        const scopedPeriods=cuts.map(([label,date])=>periodSnapshot(all,date,label,id));
        const scopedCurrent=scopedPeriods.find(p=>p.label==='CURRENT'), scopedYoy=scopedPeriods.find(p=>p.label==='YOY');
        const scopedPrior=scopedPeriods.filter(p=>['M-3','M-2','M-1'].includes(p.label));
        const scopedAvgMtd=scopedPrior.reduce((sum,p)=>sum+p.mtd_units,0)/3, scopedAvgWeek=scopedPrior.reduce((sum,p)=>sum+p.last_7d_units,0)/3;
        const details=all.filter(r=>String(r.sucursal_id)===id&&r.fecha_venta>=scopedCurrent.date_from&&r.fecha_venta<=cutoffDate);
        const previousDetails=previousCut?all.filter(r=>String(r.sucursal_id)===id&&r.fecha_venta>=monthStart(previousCut)&&r.fecha_venta<=previousCut):[];
        const scopedProjection=previousProjectionRows.filter(r=>String(r.sucursal_id)===id).reduce((sum,r)=>sum+Number(r.projected_units||0),0);
        const currentProjection=projections.filter(r=>String(r.sucursal_id)===id).reduce((sum,r)=>sum+Number(r.projected_units||0),0);
        const nextDate=plusDays(weekStart,7), nextPeriods=[-3,-2,-1].map((delta,i)=>periodSnapshot(all,shiftMonth(nextDate,delta),`M-${3-i}`,id));
        const nextAverage=nextPeriods.reduce((sum,p)=>sum+p.mtd_units,0)/nextPeriods.length, nextExpected=scopedCurrent.mtd_units+currentProjection;
        response.scopes[id]={ok:true,week_start:weekStart,sucursal_id:id,summary:{total_units:0,sent_not_invoiced_units:0},sales_mtd:{month:cutoffDate.slice(0,7),date_from:scopedCurrent.date_from,date_to:cutoffDate,cutoff_date:cutoffDate,total_units:scopedCurrent.mtd_units,rows:[...byStore(details).values()],details},historical_context:{periods:scopedPeriods,yoy:{mtd_change:ratio(scopedCurrent.mtd_units-scopedYoy.mtd_units,scopedYoy.mtd_units),last_7d_change:ratio(scopedCurrent.last_7d_units-scopedYoy.last_7d_units,scopedYoy.last_7d_units),current_mtd:scopedCurrent.mtd_units,yoy_mtd:scopedYoy.mtd_units,current_last_7d:scopedCurrent.last_7d_units,yoy_last_7d:scopedYoy.last_7d_units},recent_3m:{mtd_average:scopedAvgMtd,last_7d_average:scopedAvgWeek,mtd_change:ratio(scopedCurrent.mtd_units-scopedAvgMtd,scopedAvgMtd),last_7d_change:ratio(scopedCurrent.last_7d_units-scopedAvgWeek,scopedAvgWeek)}},next_cut_context:{cutoff_date:nextDate,expected_units:nextExpected,prior_periods:nextPeriods,prior_average:nextAverage,change_vs_prior_average:ratio(nextExpected-nextAverage,nextAverage)},evolution:previousCut?{previous_cut:previousCut,current_cut:weekStart,previous_sales_mtd:previousDetails.length,previous_projection:scopedProjection,expected_current:previousDetails.length+scopedProjection,current_sales_mtd:scopedCurrent.mtd_units,new_sales:scopedCurrent.mtd_units-previousDetails.length,projection_fulfillment:ratio(scopedCurrent.mtd_units-previousDetails.length,scopedProjection),expected_fulfillment:ratio(scopedCurrent.mtd_units,previousDetails.length+scopedProjection),stores:[]}:null,projections:[]};
      }
    }
    return NextResponse.json(response);
  } catch(error){console.error(error);return NextResponse.json({ok:false,error:error?.message||'Internal server error'},{status:400});}
}
