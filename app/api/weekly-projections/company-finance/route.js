import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';

export const dynamic = 'force-dynamic';

const formatDate = date => date.toISOString().slice(0, 10);
function priorCutoff(cutoff, offset) {
  const day = Number(cutoff.slice(8, 10));
  const d = new Date(`${cutoff.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const year = d.getUTCFullYear(), month = d.getUTCMonth();
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day,monthEnd)).padStart(2, '0')}`;
}
export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const cutoff = params.get('cutoff_date');
    const storeId = params.get('sucursal_id') || null;
    if (storeId && !/^\d+$/.test(storeId)) return NextResponse.json({ok:false,error:'Invalid sucursal_id'},{status:400});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff || '') ||
        Number.isNaN(Date.parse(cutoff)) || new Date(cutoff).toISOString().slice(0,10)!==cutoff) {
      return NextResponse.json({ok:false,error:'Invalid cutoff_date'}, {status:400});
    }
    const periods = [-3,-2,-1,0].map((n,i) => ({
      label: i===3?'CURRENT':`M-${-n}`,
      month: priorCutoff(cutoff,n).slice(0,7),
      cutoff_date: priorCutoff(cutoff,n)
    }));
    const from = periods[0].month+'-01';
    const sql = db();
    const [forum, others] = await Promise.all([
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
          AND u.fecha_cotizacion::date >= ${from}::date
          AND u.fecha_cotizacion::date <= ${cutoff}::date
          AND extract(day from u.fecha_cotizacion::date) <= ${Number(cutoff.slice(8,10))}
        GROUP BY 1
      `,
      sql`
        WITH sales AS (
          SELECT upper(trim(v.nro_vin_chasis)) vin,
                 (CASE WHEN trim(v.fecha_factura::text) ~ '^[0-9]+$'
                   THEN DATE '1899-12-30' + trim(v.fecha_factura::text)::integer
                   ELSE nullif(trim(v.fecha_factura::text),'')::date END) sold_at
          FROM ventas_raw v
          LEFT JOIN sucursales_master sm ON (
            lower(trim(sm.nombre_canonico)) = lower(trim(regexp_replace(v.desc_sucursal_vta, '^Sucursal\\s+', '', 'i')))
            OR lower(trim(sm.nombre_canonico)) = lower(trim('CIDEF ' || regexp_replace(v.desc_sucursal_vta, '^Sucursal\\s+', '', 'i')))
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza alameda' AND sm.sucursal_id=19)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza sur' AND sm.sucursal_id=9)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza egaña' AND sm.sucursal_id=11)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza norte' AND sm.sucursal_id=8)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza oeste' AND sm.sucursal_id=10)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal quilin' AND sm.sucursal_id=21)
            OR (lower(trim(v.desc_sucursal_vta))='costanera' AND sm.sucursal_id=22)
          )
          WHERE btrim(v.categoria_cliente)='Cliente General'
            AND (${storeId}::text IS NULL OR sm.sucursal_id::text=${storeId}::text)
            AND nullif(trim(v.nro_vin_chasis),'') IS NOT NULL
            AND lower(coalesce(trim(v.desc_sucursal_vta),'')) <> 'casa matriz'
            AND nullif(trim(v.entidad_financiera),'') IS NOT NULL
            AND upper(trim(v.entidad_financiera)) <> 'FORUM'
        )
        SELECT to_char(sold_at,'YYYY-MM') period_month,count(distinct vin)::int other_credits
        FROM sales
        WHERE sold_at >= ${from}::date AND sold_at <= ${cutoff}::date
          AND extract(day from sold_at) <= ${Number(cutoff.slice(8,10))}
        GROUP BY 1
      `
    ]);
    // UFI = sold VIN with FORUM as financing entity in SALES.
    const ufis = await sql`
        WITH sales AS (
          SELECT upper(trim(v.nro_vin_chasis)) vin,
                 (CASE WHEN trim(v.fecha_factura::text) ~ '^[0-9]+$'
                   THEN DATE '1899-12-30' + trim(v.fecha_factura::text)::integer
                   ELSE nullif(trim(v.fecha_factura::text),'')::date END) sold_at
          FROM ventas_raw v
          LEFT JOIN sucursales_master sm ON (
            lower(trim(sm.nombre_canonico)) = lower(trim(regexp_replace(v.desc_sucursal_vta, '^Sucursal\\s+', '', 'i')))
            OR lower(trim(sm.nombre_canonico)) = lower(trim('CIDEF ' || regexp_replace(v.desc_sucursal_vta, '^Sucursal\\s+', '', 'i')))
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza alameda' AND sm.sucursal_id=19)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza sur' AND sm.sucursal_id=9)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza egaña' AND sm.sucursal_id=11)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza norte' AND sm.sucursal_id=8)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal plaza oeste' AND sm.sucursal_id=10)
            OR (lower(trim(v.desc_sucursal_vta))='sucursal quilin' AND sm.sucursal_id=21)
            OR (lower(trim(v.desc_sucursal_vta))='costanera' AND sm.sucursal_id=22)
          )
          WHERE btrim(v.categoria_cliente)='Cliente General'
            AND (${storeId}::text IS NULL OR sm.sucursal_id::text=${storeId}::text)
            AND nullif(trim(v.nro_vin_chasis),'') IS NOT NULL
            AND lower(coalesce(trim(v.desc_sucursal_vta),'')) <> 'casa matriz'
            AND nullif(trim(v.entidad_financiera),'') IS NOT NULL
            AND upper(trim(v.entidad_financiera)) = 'FORUM'
        )
        SELECT to_char(sold_at,'YYYY-MM') period_month,count(distinct vin)::int ufi
        FROM sales
        WHERE sold_at >= ${from}::date AND sold_at <= ${cutoff}::date
          AND extract(day from sold_at) <= ${Number(cutoff.slice(8,10))}
        GROUP BY 1
      `;
    const storeForum = !storeId ? await sql`
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
          )::int aprobados,
          0::int ufi
        FROM forum_funnel_universe_v01 u JOIN matched_stores ms ON upper(trim(u.sucursal))=ms.alias
        WHERE upper(trim(u.distribuidor))='CIDEF'
          AND (u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date
            OR u.fecha_curse::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date)
        GROUP BY ms.store_id
      ` : [];
    const storeMap=new Map();
    for(const r of storeForum)storeMap.set(r.store_id,{sucursal_id:r.store_id,cotizaciones:Number(r.cotizaciones),aprobados:Number(r.aprobados),ufi:Number(r.ufi),otros:0});
    const fm=new Map(forum.map(r=>[r.period_month,r])),um=new Map(ufis.map(r=>[r.period_month,r])),om=new Map(others.map(r=>[r.period_month,r]));
    return NextResponse.json({ok:true,cutoff_date:cutoff,sucursal_id:storeId,stores:[...storeMap.values()],periods:periods.map(p=>({
      ...p,
      cotizaciones:Number(fm.get(p.month)?.cotizaciones||0),
      aprobados:Number(fm.get(p.month)?.aprobados||0),
      ufi:Number(um.get(p.month)?.ufi||0),
      otros:Number(om.get(p.month)?.other_credits||0)
    }))});
  } catch (error) {
    console.error(error);
    return NextResponse.json({ok:false,error:error?.message||'Internal server error'},{status:500});
  }
}
