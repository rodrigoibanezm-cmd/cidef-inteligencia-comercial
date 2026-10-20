import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const storeId = url.searchParams.get('sucursal_id');
    const cutoff = url.searchParams.get('cutoff_date');
    const allStores = url.searchParams.get('all_stores') === '1';
    if ((!allStores && !/^\d+$/.test(storeId || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff || '')) {
      return NextResponse.json({ ok:false, error:'Invalid sucursal_id or cutoff_date' }, { status:400 });
    }
    const sql = db();
    if (allStores) {
      const sellers = await sql`
        SELECT sucursal_id::text sucursal_id,persona_id::text persona_id,ombu_id,nombre
        FROM weekly_projection_sellers
        WHERE habilitado=true AND estado='ACTIVO' AND persona_id IS NOT NULL
        ORDER BY sucursal_id,nombre
      `;
      const aliases = await sql`
        WITH active AS (
          SELECT persona_id,sucursal_id,nombre,ombu_id FROM weekly_projection_sellers
          WHERE habilitado=true AND estado='ACTIVO' AND persona_id IS NOT NULL
        ),
        raw_aliases AS (
          SELECT a.persona_id,w.sucursal_id,upper(trim(a.valor_raw)) alias
          FROM persona_aliases a JOIN active w ON w.persona_id=a.persona_id
          WHERE a.validated=true AND nullif(trim(a.valor_raw),'') IS NOT NULL
          UNION ALL SELECT persona_id,sucursal_id,upper(trim(nombre)) FROM active
          UNION ALL SELECT persona_id,sucursal_id,upper(trim(ombu_id)) FROM active WHERE ombu_id IS NOT NULL
        )
        , unique_aliases AS (
          SELECT alias,sucursal_id,min(persona_id)::text persona_id FROM raw_aliases
          GROUP BY alias,sucursal_id HAVING count(distinct persona_id)=1
        )
        SELECT DISTINCT r.alias,u.persona_id,r.sucursal_id::text sucursal_id
        FROM raw_aliases r JOIN unique_aliases u ON u.alias=r.alias AND u.sucursal_id=r.sucursal_id AND u.persona_id=r.persona_id::text
      `;
      const forum = await sql`
        WITH active AS (
          SELECT DISTINCT persona_id,sucursal_id FROM weekly_projection_sellers
          WHERE habilitado=true AND estado='ACTIVO' AND persona_id IS NOT NULL
        ),
        valid_alias AS (
          SELECT upper(trim(a.valor_raw)) alias,w.sucursal_id,min(a.persona_id) persona_id
          FROM persona_aliases a JOIN active w ON w.persona_id=a.persona_id
          WHERE a.validated=true AND a.fuente ILIKE '%forum%'
          GROUP BY upper(trim(a.valor_raw)),w.sucursal_id
          HAVING count(distinct a.persona_id)=1
        )
        SELECT a.sucursal_id::text sucursal_id,a.persona_id::text persona_id,
          count(distinct u.numero_operacion) FILTER (WHERE u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date)::int cotizaciones,
          count(distinct u.numero_operacion) FILTER (WHERE u.estado_actual='APROBADA' AND u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date)::int aprobados,
          coalesce(sum(u.ufi_curse) FILTER (WHERE u.fecha_curse::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date),0)::int ufi
        FROM forum_funnel_universe_v01 u
        JOIN valid_alias a ON upper(trim(u.vendedor))=a.alias
        WHERE upper(trim(u.distribuidor))='CIDEF'
          AND (u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date
            OR u.fecha_curse::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date)
        GROUP BY a.sucursal_id,a.persona_id
      `;
      return NextResponse.json({ok:true,aliases,forum,sellers});
    }
    // Only validated, unambiguous aliases can identify a salesperson.
    const aliases = await sql`
      WITH active AS (
        SELECT persona_id, nombre, ombu_id
        FROM weekly_projection_sellers
        WHERE sucursal_id=${storeId}::bigint AND habilitado=true AND estado='ACTIVO' AND persona_id IS NOT NULL
      ),
      raw_aliases AS (
        SELECT a.persona_id, upper(trim(a.valor_raw)) alias
        FROM persona_aliases a JOIN active w ON w.persona_id=a.persona_id
        WHERE a.validated=true AND nullif(trim(a.valor_raw),'') IS NOT NULL
        UNION ALL SELECT persona_id,upper(trim(nombre)) FROM active
        UNION ALL SELECT persona_id,upper(trim(ombu_id)) FROM active WHERE ombu_id IS NOT NULL
      )
      SELECT alias,min(persona_id)::text persona_id
      FROM raw_aliases GROUP BY alias HAVING count(distinct persona_id)=1
    `;
    const forum = await sql`
      WITH active AS (
        SELECT persona_id FROM weekly_projection_sellers
        WHERE sucursal_id=${storeId}::bigint AND habilitado=true AND estado='ACTIVO' AND persona_id IS NOT NULL
      ),
      valid_alias AS (
        SELECT upper(trim(a.valor_raw)) alias, min(a.persona_id) persona_id
        FROM persona_aliases a
        WHERE a.validated=true AND a.fuente ILIKE '%forum%'
          AND a.persona_id IN (SELECT persona_id FROM active)
        GROUP BY upper(trim(a.valor_raw)) HAVING count(distinct a.persona_id)=1
      )
      SELECT a.persona_id::text persona_id,
        count(distinct u.numero_operacion) FILTER (WHERE u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date) ::int cotizaciones,
        count(distinct u.numero_operacion) FILTER (WHERE u.estado_actual='APROBADA' AND u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date) ::int aprobados,
        coalesce(sum(u.ufi_curse) FILTER (WHERE u.fecha_curse::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date),0)::int ufi
      FROM forum_funnel_universe_v01 u
      JOIN valid_alias a ON upper(trim(u.vendedor))=a.alias
      WHERE upper(trim(u.distribuidor))='CIDEF'
        AND (u.fecha_cotizacion::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date
          OR u.fecha_curse::date BETWEEN date_trunc('month',${cutoff}::date)::date AND ${cutoff}::date)
      GROUP BY a.persona_id
    `;
    return NextResponse.json({ok:true,aliases,forum});
  } catch (error) {
    console.error(error);
    return NextResponse.json({ok:false,error:error?.message||'Internal server error'},{status:500});
  }
}
