import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sql = db();
    const rows = await sql`
      SELECT sucursal_id, nombre_canonico
      FROM sucursales_master
      WHERE vigente IS TRUE
        AND tipo_canal = 'CIDEF'
        AND lower(trim(nombre_canonico)) <> 'casa matriz'
      ORDER BY nombre_canonico
    `;
    return NextResponse.json({ ok: true, sucursales: rows });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
