import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sql = db();
    const [modelos, versiones] = await Promise.all([
      sql`
        SELECT DISTINCT
          m.modelo_id::text AS modelo_id,
          ma.marca_id::text AS marca_id,
          ma.nombre_canonico AS marca,
          m.nombre_canonico AS modelo
        FROM producto_portafolio_v01 pp
        JOIN modelos_master_v01 m ON m.modelo_id = pp.modelo_id
        JOIN marcas_master_v01 ma ON ma.marca_id = pp.marca_id
        WHERE pp.vigente = true
          AND pp.organizacion = 'CIDEF'
        ORDER BY ma.nombre_canonico, m.nombre_canonico
      `,
      sql`
        SELECT DISTINCT
          v.version_id::text AS version_id,
          v.modelo_id::text AS modelo_id,
          v.nombre_canonico AS version
        FROM versiones_master_v01 v
        WHERE EXISTS (
          SELECT 1
          FROM producto_portafolio_v01 pp
          WHERE pp.modelo_id = v.modelo_id
            AND pp.vigente = true
            AND pp.organizacion = 'CIDEF'
        )
        ORDER BY v.modelo_id, v.nombre_canonico
      `,
    ]);

    return NextResponse.json({ ok: true, modelos, versiones });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}
