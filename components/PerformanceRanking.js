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
function RankingItems({items,mode,category,positive}){
 const ordered=[...items].sort((a,b)=>{
  if(mode==="trajectory"){const av=growth(a,category),bv=growth(b,category);return ((positive?bv-av:av-bv)||b.vin-a.vin)||a.name.localeCompare(b.name,"es");}
  return (positive?b.vin-a.vin:a.vin-b.vin)||a.name.localeCompare(b.name,"es");
 }).slice(0,5);
 return <div className="rank-items">{ordered.length?ordered.map((r,i)=>{
 const delta=growth(r,category);
 return <div className="rank-result" key={r.id+"-"+i}>
 <div className="rank-item-main"><span className="rank-position">{i+1}.</span><strong title={r.name}>{r.name.replace(/^CIDEF /,"")}</strong><b>{number(r.vin)} VIN</b></div>
 <div className="rank-item-secondary"><span>{mode==="trajectory"&&delta!==null?<span className={"rank-delta "+(delta>=0?"positive":"negative")}>{percent(delta)}</span>:<span className="rank-neutral">{category==="sellers"?"Cobertura parcial":delta===null?"Sin base suficiente":percent(delta)}</span>}</span><Trend months={r.months}/></div>
 </div>;
 }):<p className="rank-none">No hay casos con historial suficiente para este criterio.</p>}</div>;
}
export default function PerformanceRanking(){
 const [category,setCategory]=useState("stores");
 const [criterion,setCriterion]=useState("trajectory");
 const current=categories.find(x=>x.id===category),items=rankings.categories[category];
 const canTrajectory=category!=="sellers";
 const mode=!canTrajectory?"volume":criterion;
 const available=mode==="trajectory"?items.filter(r=>category==="dealers"?(Number.isFinite(r.quarter_change)&&r.q2>=15&&r.q3>=15):eligible(r,category)):items.filter(r=>r.vin>0);
 const titleBest=mode==="trajectory"?"Mejor trayectoria":"Mayor volumen";
 const titleWorst=mode==="trajectory"?"En alerta · trayectoria":"Menor volumen";
 const info=category==="sellers"
 ?"Vendedores: cifras de un snapshot SALES parcial (274 VIN cubiertos). No es un ranking completo del cierre ni permite calificar desempeño; se muestra solo volumen observado."
 :category==="dealers"
 ?"Dealers: volumen de septiembre del cierre histórico. La trayectoria disponible compara Q3 vs Q2; no es una comparación mensual de cuatro puntos. Se exige volumen trimestral mínimo para alertas."
 :category==="models"
 ?"Modelos: agrupación orientativa por nombre/modelo de los VIN. Los nombres no homologados se excluyen; revisar con maestro canónico antes de certificar el ranking."
 :"Tiendas: conteos por VIN desde ventas_raw al 30 de septiembre (375 VIN; el snapshot cerrado indica 377). Trajectory = septiembre frente al promedio junio–agosto; nuevas/sin historia quedan fuera de alertas.";
 return <section className="mc-panel mc-rank-section" aria-label="Ranking de desempeño comercial">
 <div className="mc-panel-head"><div><h2>Ranking de desempeño comercial</h2><p className="rank-subtitle">Destacados y señales de alerta · septiembre 2026 · fuente SALES</p></div><span>Top 5 · VIN primero</span></div>
 <div className="rank-controls">
 <div className="rank-cats" role="group" aria-label="Categoría">{categories.map(c=><button type="button" key={c.id} className={category===c.id?"selected":""} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.title}</button>)}</div>
 <div className="rank-modes" role="group" aria-label="Criterio"><button type="button" className={mode==="trajectory"?"selected":""} aria-pressed={mode==="trajectory"} disabled={!canTrajectory} onClick={()=>setCriterion("trajectory")}>Trayectoria</button><button type="button" className={mode==="volume"?"selected":""} aria-pressed={mode==="volume"} onClick={()=>setCriterion("volume")}>Ventas N</button></div>
 </div>
 <div className="rank-columns"><div className="rank-panel"><div className="rank-panel-header"><span className="rank-up">↗</span><strong>Top 5 · {titleBest}</strong></div><RankingItems items={available} mode={mode} category={category} positive/></div>
 <div className="rank-panel"><div className="rank-panel-header"><span className="rank-down">↘</span><strong>Top 5 · {titleWorst}</strong></div><RankingItems items={available} mode={mode} category={category} positive={false}/></div></div>
 <p className="rank-source-note">{info}</p>
 <p className="rank-source-note">La variación por tiendas/modelos compara septiembre con el promedio de junio, julio y agosto. Para vendedores todavía no existe una serie conciliada: no se fabrican cambios porcentuales. Volumen bajo no equivale automáticamente a bajo desempeño.</p>
 </section>;
}
