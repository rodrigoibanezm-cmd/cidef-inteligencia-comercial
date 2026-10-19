import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
export const dynamic='force-dynamic';
const STATES=['ACTIVO','VACACIONES','LICENCIA','OTRO'];
const bad=(m,s=400)=>NextResponse.json({ok:false,error:m},{status:s});
const pos=v=>/^\d+$/.test(String(v??''))&&BigInt(String(v))>0n;

export async function GET(request){
 try{const s=new URL(request.url).searchParams.get('sucursal_id');if(!pos(s))return bad('sucursal_id must be a positive integer');const sql=db();const rows=await sql`SELECT seller_id::text,sucursal_id::text,persona_id::text,ombu_id,nombre,estado FROM weekly_projection_sellers WHERE sucursal_id=${s}::bigint AND habilitado=true ORDER BY nombre`;return NextResponse.json({ok:true,vendedores:rows})}catch(e){return bad(e.message,500)}
}

export async function POST(request){
 try{const b=await request.json(),s=String(b.sucursal_id??''),nombre=String(b.nombre??'').trim(),ombu=String(b.ombu_id??'').trim();if(!pos(s))return bad('Sucursal inválida');if(!nombre)return bad('Falta nombre');if(!ombu)return bad('Falta ID OMBU');const sql=db();
 const branch=await sql`SELECT 1 FROM sucursales_master WHERE sucursal_id=${s}::bigint AND vigente=true AND tipo_canal='CIDEF' LIMIT 1`;if(!branch.length)return bad('Sucursal inválida');
 let people=await sql`SELECT persona_id::text FROM personas_master WHERE usuario_canonico=${ombu} LIMIT 1`;
 if(!people.length)people=await sql`INSERT INTO personas_master(usuario_canonico,nombre_canonico,confidence,evidence_count,validated,created_at,updated_at) VALUES(${ombu},${nombre},1,1,false,now(),now()) RETURNING persona_id::text`;
 const persona=people[0].persona_id;
 await sql`INSERT INTO persona_sucursal(persona_sucursal_id,persona_id,sucursal_id,rol,vigente,fuente) VALUES(nextval('persona_sucursal_persona_sucursal_id_seq'),${persona}::bigint,${s}::bigint,'VENDEDOR_TIENDA',true,'PROYECCION_MANUAL') ON CONFLICT DO NOTHING`;
 const r=await sql`INSERT INTO weekly_projection_sellers(sucursal_id,persona_id,ombu_id,nombre,estado,habilitado,updated_at) VALUES(${s}::bigint,${persona}::bigint,${ombu},${nombre},'ACTIVO',true,now()) ON CONFLICT(ombu_id) DO UPDATE SET sucursal_id=EXCLUDED.sucursal_id,persona_id=EXCLUDED.persona_id,nombre=EXCLUDED.nombre,estado='ACTIVO',habilitado=true,updated_at=now() RETURNING seller_id::text,sucursal_id::text,persona_id::text,ombu_id,nombre,estado`;return NextResponse.json({ok:true,vendedor:r[0]},{status:201})
 }catch(e){return bad(e.message,500)}
}

export async function PATCH(request){
 try{const b=await request.json(),seller=String(b.seller_id??''),estado=String(b.estado??'').toUpperCase();if(!pos(seller))return bad('Vendedor inválido');if(!STATES.includes(estado))return bad('Estado inválido');const sql=db();const r=await sql`UPDATE weekly_projection_sellers SET estado=${estado},updated_at=now() WHERE seller_id=${seller}::bigint AND habilitado=true RETURNING seller_id::text,estado`;if(!r.length)return bad('Vendedor no encontrado',404);return NextResponse.json({ok:true,vendedor:r[0]})}catch(e){return bad(e.message,500)}
}

export async function DELETE(request){
 try{const b=await request.json(),seller=String(b.seller_id??'');if(!pos(seller))return bad('Vendedor inválido');const sql=db();const r=await sql`UPDATE weekly_projection_sellers SET habilitado=false,updated_at=now() WHERE seller_id=${seller}::bigint RETURNING seller_id::text`;return NextResponse.json({ok:true,deleted:r.length===1})}catch(e){return bad(e.message,500)}
}
