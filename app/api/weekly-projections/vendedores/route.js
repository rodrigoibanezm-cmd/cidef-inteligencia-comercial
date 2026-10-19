import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
export const dynamic='force-dynamic';
export async function GET(request){try{const id=new URL(request.url).searchParams.get('sucursal_id');if(!/^\d+$/.test(id||''))return NextResponse.json({ok:false,error:'sucursal_id must be a positive integer'},{status:400});const sql=db();const rows=await sql`SELECT seller_id::text,persona_id::text,ombu_id,nombre FROM weekly_projection_sellers WHERE sucursal_id=${id}::bigint AND habilitado=true AND estado='ACTIVO' AND persona_id IS NOT NULL ORDER BY nombre`;return NextResponse.json({ok:true,sucursal_id:id,vendedores:rows})}catch(e){return NextResponse.json({ok:false,error:e?.message||'Internal server error'},{status:500})}}
