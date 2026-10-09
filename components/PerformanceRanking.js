"use client";
import { useState } from "react";
import rankings from "../data/monthly-close/2026-09/performance-ranking.json";

const categories=[
 {id:"stores",title:"Tiendas propias",unit:"VIN",basis:"4 meses"},
 {id:"sellers",title:"Vendedores",unit:"VIN",basis:"Corte parcial"},
 {id:"dealers",title:"Dealers",unit:"VIN",basis:"Q3 vs Q2"},
 {id:"models",title:"Modelos",unit:"VIN",basis:"4 meses"}
];
const number=v=>new Intl.NumberFormat("es-CL",{maximumFractionDigits:1}).format(v);
const percent=v=>(v>0?"+":"")+number(v*100)+"%";
const recent=["2026-06","2026-07","2026-08","2026-09"];
const labels=["Jun","Jul","Ago","Sep"];
function eligible(r,cat){const floor=cat==="models"?8:5;return r.months&&r.active_prior_months===3&&r.prior_avg>=floor;}
function growth(r,cat){if(cat==="dealers")return Number.isFinite(r.quarter_change)?r.quarter_change:null;if(!eligible(r,cat))return null;return r.prior_avg?(r.vin/r.prior_avg)-1:null;}
function Trend({months}){if(!months)return null;const max=Math.max(1,...recent.map(k=>months[k]||0));return <div className="rank-mini-trend" aria-label="Ventas junio a septiembre">{recent.map((k,i)=><div key={k} title={labels[i]+": "+number(months[k]||0)+" VIN"}><div className="rank-mini-track"><span style={{height:(Math.max(2,(months[k]||0)/max*100))+"%"}}/></div><small>{labels[i]}</small></div>)}</div>;}
function RankingItems({items,category,positive}){
 const ordered=[...items].sort((a,b)=>{
  const av=growth(a,category),bv=growth(b,category);
  return (positive?bv-av:av-bv)||b.vin-a.vin||a.name.localeCompare(b.name,"es");
 }).slice(0,5);
 return <div className="rank-items">{ordered.length?ordered.map((r,i)=>{
 const delta=growth(r,category);
 return <div className="rank-result" key={r.id+"-"+i}>
 <div className="rank-item-main"><span className="rank-position">{i+1}.</span><strong title={r.name}>{r.name.replace(/^CIDEF /,"")}</strong><b>{number(r.vin)} VIN</b></div>
 <div className="rank-item-secondary"><span className={"rank-delta "+(delta>=0?"positive":"negative")}>{percent(delta)}</span><Trend months={r.months}/></div>
 </div>;
 }):<p className="rank-none">No hay casos con historial suficiente para clasificar.</p>}</div>;
}
export default function PerformanceRanking(){
 const [category,setCategory]=useState("stores");
 const items=rankings.categories[category];
 const available=items.filter(r=>category==="dealers"
  ? Number.isFinite(r.quarter_change)&&r.q2>=15&&r.q3>=15
  : eligible(r,category));
 const info=category==="sellers"
 ?"Vendedores: cifras de un snapshot SALES parcial (274 VIN cubiertos). No es un ranking completo del cierre y no permite evaluar trayectoria. No se publica ranking de vendedores hasta disponer de datos comparables."
 :category==="dealers"
 ?"Dealers: 667 de 667 VIN asignados al grupo comercial usando RUT de dealers_master y, para un VIN facturado a Forum Distribuidora, el comentario validado de su nota de venta. Comparación Q3 vs Q2 solo para grupos con historial anterior disponible; los grupos recién resueltos no reciben variaciones inventadas."
 :category==="models"
 ?"Modelos: agrupación orientativa por nombre/modelo de los VIN. Los nombres no homologados se excluyen; revisar con maestro canónico antes de certificar el ranking."
 :"Tiendas: conteos por VIN desde ventas_raw al 30 de septiembre (375 VIN; el snapshot cerrado indica 377). Trajectory = septiembre frente al promedio junio–agosto; nuevas/sin historia quedan fuera de alertas.";
 return <section className="mc-panel mc-rank-section" aria-label="Ranking de desempeño comercial">
 <div className="mc-panel-head"><div><h2>Ranking de desempeño comercial</h2><p className="rank-subtitle">Destacados y señales de alerta · septiembre 2026 · fuente SALES</p></div><span>Top 5 · ordenado por trayectoria</span></div>
 <div className="rank-controls">
 <div className="rank-cats" role="group" aria-label="Categoría">{categories.map(c=><button type="button" key={c.id} className={category===c.id?"selected":""} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.title}</button>)}</div>
 </div>
 {category==="sellers"?<div className="rank-unavailable"><strong>Trayectoria de vendedores no disponible</strong><p>Falta completar y conciliar el histórico de ventas por vendedor para ordenar destacados y alertas. El ranking no se construirá usando solo el volumen de septiembre.</p></div>:
 <div className="rank-columns"><div className="rank-panel"><div className="rank-panel-header"><span className="rank-up">↗</span><strong>Top 5 · Mejor trayectoria</strong></div><RankingItems items={available} category={category} positive/></div>
 <div className="rank-panel"><div className="rank-panel-header"><span className="rank-down">↘</span><strong>Top 5 · En alerta</strong></div><RankingItems items={available} category={category} positive={false}/></div></div>}
 <p className="rank-source-note">{info}</p>
 <p className="rank-source-note">La variación por tiendas/modelos compara septiembre con el promedio de junio, julio y agosto. Para vendedores todavía no existe una serie conciliada: no se fabrican cambios porcentuales. Volumen bajo no equivale automáticamente a bajo desempeño.</p>
 </section>;
}
